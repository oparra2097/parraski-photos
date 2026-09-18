#!/usr/bin/env node
// Builds the whole site into public/. Run `npm run build` after adding photos;
// pass --force to re-encode everything instead of reusing the cache.

import { mkdir, writeFile, readFile, readdir, rm, cp } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPhotos } from './photos.mjs'
import { homePage, albumPage, aboutPage, notFoundPage, sitemap, robots, favicon } from './templates.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ORIGINALS = path.join(ROOT, 'originals')
const OUT = path.join(ROOT, 'public')
const force = process.argv.includes('--force')

async function writePage(relativePath, html) {
  const target = path.join(OUT, relativePath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, html)
}

// Removes derivatives left behind by photos or albums that no longer exist,
// so deleting a source file actually shrinks the published site.
async function prune(albums) {
  const photosDir = path.join(OUT, 'photos')
  const expected = new Map()
  for (const album of albums) {
    expected.set(
      album.slug,
      new Set(album.photos.flatMap((photo) => photo.variants.map((v) => path.basename(v.url)))),
    )
  }

  let removed = 0
  let albumDirs = []
  try {
    albumDirs = await readdir(photosDir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return 0
    throw error
  }

  for (const dir of albumDirs) {
    if (!dir.isDirectory()) continue
    const target = path.join(photosDir, dir.name)
    if (!expected.has(dir.name)) {
      await rm(target, { recursive: true, force: true })
      removed++
      continue
    }
    const keep = expected.get(dir.name)
    for (const file of await readdir(target)) {
      if (!keep.has(file)) {
        await rm(path.join(target, file), { force: true })
        removed++
      }
    }
  }

  // Album pages for albums that are gone.
  const albumsDir = path.join(OUT, 'albums')
  try {
    for (const dir of await readdir(albumsDir, { withFileTypes: true })) {
      if (dir.isDirectory() && !expected.has(dir.name)) {
        await rm(path.join(albumsDir, dir.name), { recursive: true, force: true })
        removed++
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  return removed
}

async function main() {
  const started = Date.now()
  const config = JSON.parse(await readFile(path.join(ROOT, 'site.config.json'), 'utf8'))
  await mkdir(ORIGINALS, { recursive: true })
  await mkdir(OUT, { recursive: true })

  console.log(`Building ${config.title}${force ? ' (forced re-encode)' : ''}`)
  const { albums } = await buildPhotos({ originalsDir: ORIGINALS, outDir: OUT, config, force })

  const removed = await prune(albums)
  if (removed > 0) console.log(`  pruned ${removed} stale file(s)`)

  await writePage('index.html', homePage({ config, albums }))
  await writePage('about/index.html', aboutPage({ config }))
  await writePage('404.html', notFoundPage({ config }))
  if (albums.length > 1) {
    for (const album of albums) {
      await writePage(`albums/${album.slug}/index.html`, albumPage({ config, album }))
    }
  }

  await writePage('sitemap.xml', sitemap({ config, albums }))
  await writePage('robots.txt', robots({ config }))
  await writePage('favicon.svg', favicon({ config }))

  // A machine-readable index of the gallery. Nothing on the site needs it,
  // but it makes the collection easy to reuse elsewhere.
  await writeFile(
    path.join(OUT, 'photos.json'),
    JSON.stringify(
      {
        site: { title: config.title, url: config.url, author: config.author },
        albums: albums.map((album) => ({
          slug: album.slug,
          title: album.title,
          description: album.description ?? null,
          photos: album.photos.map(({ index, sources, fallback, full, ...photo }) => photo),
        })),
      },
      null,
      2,
    ),
  )

  await cp(path.join(ROOT, 'src', 'css'), path.join(OUT, 'css'), { recursive: true })
  await cp(path.join(ROOT, 'src', 'js'), path.join(OUT, 'js'), { recursive: true })

  // Anything dropped in src/static/ ships as-is: _headers, _redirects, a CNAME,
  // verification files. Optional — skipped when the directory does not exist.
  await cp(path.join(ROOT, 'src', 'static'), OUT, { recursive: true, force: true }).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })

  const pages = 3 + (albums.length > 1 ? albums.length : 0)
  console.log(`  ${albums.length} album(s) · ${pages} pages · ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log(`Done. Preview with: npm run serve`)
}

main().catch((error) => {
  console.error(`\nBuild failed: ${error.message}`)
  process.exitCode = 1
})
