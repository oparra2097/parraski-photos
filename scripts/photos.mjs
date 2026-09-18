// Image pipeline: scans originals/, writes resized derivatives into public/photos/,
// and returns a manifest describing every album and photo.
//
// Derivatives are written WITHOUT metadata (sharp's default), so GPS coordinates
// and other EXIF in the masters never reach the published site. Camera settings
// shown on the page are read from the master and copied into the manifest by hand.

import { readdir, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import exifReader from 'exif-reader'

const SOURCE_EXT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.avif', '.heic', '.heif'])

export function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled'
}

// "2024-03-15_chamonix-couloir.jpg" -> "Chamonix Couloir".
// Camera-default names (DSC01234, IMG_4821) carry no meaning, so they become "".
function titleFromFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, '')
  const withoutDate = base.replace(/^\d{4}[-_]?\d{2}[-_]?\d{2}[-_\s]*/, '')
  if (/^(img|dsc|dscf|_dsc|_mg|p|pxl|gopr|dji)[-_]?\d+$/i.test(withoutDate)) return ''
  return withoutDate
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

function formatShutter(seconds) {
  if (!seconds) return null
  if (seconds >= 1) return `${Number(seconds.toFixed(1))}s`
  return `1/${Math.round(1 / seconds)}s`
}

// Pulls the handful of fields worth showing under a photo. Anything we can't
// read is simply omitted — a missing lens is not an error.
function readExif(exifBuffer) {
  if (!exifBuffer) return null
  let raw
  try {
    raw = exifReader(exifBuffer)
  } catch {
    return null
  }
  const image = raw.Image ?? raw.image ?? {}
  const photo = raw.Photo ?? raw.exif ?? {}

  const make = (image.Make ?? '').trim()
  const model = (image.Model ?? '').trim()
  const camera = model.toLowerCase().startsWith(make.toLowerCase()) ? model : [make, model].filter(Boolean).join(' ')
  const iso = photo.ISOSpeedRatings ?? photo.PhotographicSensitivity
  const taken = photo.DateTimeOriginal instanceof Date && !Number.isNaN(photo.DateTimeOriginal.valueOf())
    ? photo.DateTimeOriginal.toISOString()
    : null

  const exif = {
    camera: camera || null,
    lens: (photo.LensModel ?? '').trim() || null,
    focal: photo.FocalLength ? `${Math.round(photo.FocalLength)}mm` : null,
    aperture: photo.FNumber ? `f/${Number(photo.FNumber.toFixed(1))}` : null,
    shutter: formatShutter(photo.ExposureTime),
    iso: Array.isArray(iso) ? iso[0] : iso ?? null,
    taken,
  }
  return Object.values(exif).some((v) => v !== null) ? exif : null
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw new Error(`${file} is not valid JSON: ${error.message}`)
  }
}

// Runs tasks with a bounded number in flight. sharp releases the event loop
// while encoding, so a small pool keeps every core busy without thrashing.
async function pool(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

async function listImages(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && !e.name.startsWith('.') && SOURCE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

// One album per subdirectory of originals/; loose files at the top level become
// a single default album so the site works before anything is organised.
async function discoverAlbums(originalsDir) {
  const entries = await readdir(originalsDir, { withFileTypes: true })
  const albums = []

  const loose = await listImages(originalsDir)
  if (loose.length > 0) {
    albums.push({ dir: originalsDir, slug: 'gallery', title: 'Gallery', files: loose, order: 0 })
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue
    const dir = path.join(originalsDir, entry.name)
    const files = await listImages(dir)
    if (files.length === 0) continue
    const meta = (await readJsonIfPresent(path.join(dir, 'album.json'))) ?? {}
    albums.push({
      dir,
      slug: slugify(meta.slug ?? entry.name),
      title: meta.title ?? titleFromFilename(entry.name) ?? entry.name,
      description: meta.description ?? null,
      cover: meta.cover ?? null,
      order: meta.order ?? 100,
      files,
    })
  }

  return albums.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
}

function srcsetFor(variants, format) {
  const seen = new Set()
  return variants
    .filter((v) => v.format === format)
    .filter((v) => (seen.has(v.width) ? false : seen.add(v.width)))
    .sort((a, b) => a.width - b.width)
    .map((v) => `${v.url} ${v.width}w`)
    .join(', ')
}

export async function buildPhotos({ originalsDir, outDir, config, force = false, log = console.log }) {
  const albums = await discoverAlbums(originalsDir)
  if (albums.length === 0) return { albums: [], stats: { photos: 0, generated: 0, reused: 0, bytes: 0 } }

  const cacheFile = path.join(path.dirname(outDir), '.cache', 'photos.json')
  const cache = force ? {} : ((await readJsonIfPresent(cacheFile)) ?? {})
  const nextCache = {}
  const stats = { photos: 0, generated: 0, reused: 0, bytes: 0 }
  const concurrency = Math.max(2, Math.min(8, os.cpus().length))

  for (const album of albums) {
    const captions = (await readJsonIfPresent(path.join(album.dir, 'captions.json'))) ?? {}
    const albumOut = path.join(outDir, 'photos', album.slug)
    await mkdir(albumOut, { recursive: true })

    album.photos = await pool(album.files, concurrency, async (file, index) => {
      const source = path.join(album.dir, file)
      const info = await stat(source)
      const cacheKey = `${album.slug}/${file}`
      const fingerprint = `${info.mtimeMs}:${info.size}:${JSON.stringify(config.sizes)}:${JSON.stringify(config.formats)}`
      const cached = cache[cacheKey]

      let record
      if (cached && cached.fingerprint === fingerprint) {
        record = cached.record
        stats.reused++
      } else {
        // .rotate() applies the EXIF orientation tag and then drops it, so
        // downstream widths and heights describe the image as it will display.
        const pipeline = sharp(source, { failOn: 'error' }).rotate()
        const [metadata, imageStats] = await Promise.all([pipeline.metadata(), pipeline.stats()])
        const upright = (metadata.orientation ?? 1) >= 5
        const width = upright ? metadata.height : metadata.width
        const height = upright ? metadata.width : metadata.height
        const slug = slugify(`${titleFromFilename(file) || path.parse(file).name}`)

        const variants = []
        for (const size of config.sizes) {
          for (const format of config.formats) {
            const name = `${slug}-${size.width}.${format.ext}`
            const target = path.join(albumOut, name)
            const output = await pipeline
              .clone()
              .resize({ width: size.width, withoutEnlargement: true })
              .toFormat(format.ext, { quality: format.quality, effort: format.ext === 'avif' ? 4 : 5 })
              .toFile(target)
            variants.push({
              format: format.ext,
              width: output.width,
              height: output.height,
              bytes: output.size,
              url: `/photos/${album.slug}/${name}`,
            })
          }
        }

        const dominant = imageStats.dominant
        const override = captions[file] ?? {}
        const title = override.title ?? titleFromFilename(file)
        record = {
          id: `${album.slug}/${slug}`,
          slug,
          file,
          title: title || null,
          caption: override.caption ?? null,
          alt: override.alt ?? title ?? `Photograph from ${album.title}`,
          width,
          height,
          color: `rgb(${dominant.r} ${dominant.g} ${dominant.b})`,
          exif: readExif(metadata.exif),
          variants,
        }
        stats.generated++
      }

      nextCache[cacheKey] = { fingerprint, record }
      stats.photos++
      stats.bytes += record.variants.reduce((sum, v) => sum + v.bytes, 0)

      const largest = record.variants.reduce((a, b) => (a.width >= b.width ? a : b))
      return {
        ...record,
        index,
        sources: config.formats.map((f) => ({ type: `image/${f.ext}`, srcset: srcsetFor(record.variants, f.ext) })),
        fallback: record.variants.filter((v) => v.format === config.formats.at(-1).ext).sort((a, b) => a.width - b.width)[0]?.url ?? largest.url,
        full: largest.url,
      }
    })

    const coverPhoto = album.cover
      ? album.photos.find((p) => p.file === album.cover || p.slug === slugify(album.cover))
      : null
    album.coverPhoto = coverPhoto ?? album.photos[0]
  }

  await mkdir(path.dirname(cacheFile), { recursive: true })
  await writeFile(cacheFile, JSON.stringify(nextCache))
  log(`  ${stats.photos} photos · ${stats.generated} generated · ${stats.reused} cached · ${(stats.bytes / 1e6).toFixed(1)} MB output`)

  return { albums, stats }
}
