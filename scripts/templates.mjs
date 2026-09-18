// HTML generation. Every page is rendered here from the manifest that
// photos.mjs produces, so the published site needs no client-side framework.

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const GRID_SIZES = '(max-width: 640px) 92vw, (max-width: 1100px) 46vw, 30vw'

export function exifLine(photo) {
  if (!photo.exif) return ''
  const { camera, lens, focal, aperture, shutter, iso } = photo.exif
  return [camera, lens, focal, aperture, shutter, iso ? `ISO ${iso}` : null].filter(Boolean).join(' · ')
}

function layout({ config, title, description, path: pagePath, image, body, activeNav }) {
  const fullTitle = pagePath === '/' ? `${config.title} — ${config.tagline}` : `${title} — ${config.title}`
  const canonical = `${config.url.replace(/\/$/, '')}${pagePath}`
  const ogImage = image ? `${config.url.replace(/\/$/, '')}${image}` : null
  const nav = [
    { label: 'Work', href: '/' },
    { label: 'About', href: '/about/' },
  ]

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0b0c0e" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#fbfbfa" media="(prefers-color-scheme: light)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/site.css">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ImageGallery',
    name: config.title,
    description: config.description,
    url: canonical,
    author: { '@type': 'Person', name: config.author },
  })}</script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <a class="wordmark" href="/">${esc(config.title)}</a>
  <nav aria-label="Primary">
    ${nav.map((item) => `<a href="${item.href}"${activeNav === item.label ? ' aria-current="page"' : ''}>${item.label}</a>`).join('\n    ')}
  </nav>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <p>© ${new Date().getFullYear()} ${esc(config.author)}</p>
  <p class="footer-links">
    <a href="mailto:${esc(config.email)}">${esc(config.email)}</a>
    ${(config.links ?? []).map((l) => `<a href="${esc(l.url)}" rel="me noopener">${esc(l.label)}</a>`).join('\n    ')}
  </p>
</footer>
<script src="/js/gallery.js" type="module"></script>
</body>
</html>
`
}

// `eager` marks how many leading images skip lazy-loading — the ones likely
// above the fold. Everything after that loads as the viewer scrolls.
function tile(photo, { eager = false } = {}) {
  const exif = exifLine(photo)
  const sources = photo.sources
    .filter((s) => s.srcset)
    .map((s) => `<source type="${s.type}" srcset="${esc(s.srcset)}" sizes="${GRID_SIZES}">`)
    .join('')

  return `<a class="tile" href="${esc(photo.full)}"
   style="--ar:${(photo.height / photo.width).toFixed(4)};--tone:${esc(photo.color)}"
   data-photo
   data-title="${esc(photo.title ?? '')}"
   data-caption="${esc(photo.caption ?? '')}"
   data-exif="${esc(exif)}"
   data-alt="${esc(photo.alt)}"
   data-width="${photo.width}"
   data-height="${photo.height}"
   ${photo.sources.map((s) => `data-srcset-${s.type.split('/')[1]}="${esc(s.srcset)}"`).join('\n   ')}>
  <picture>
    ${sources}
    <img src="${esc(photo.fallback)}" alt="${esc(photo.alt)}" width="${photo.width}" height="${photo.height}"
         loading="${eager ? 'eager' : 'lazy'}" decoding="async"${eager ? ' fetchpriority="high"' : ''}>
  </picture>
  ${photo.title ? `<span class="tile-label">${esc(photo.title)}</span>` : ''}
</a>`
}

function grid(photos) {
  return `<div class="grid" data-grid>
${photos.map((photo, i) => tile(photo, { eager: i < 4 })).join('\n')}
</div>`
}

export function homePage({ config, albums }) {
  const single = albums.length === 1
  const cover = albums[0]?.coverPhoto

  const body = `
<section class="hero">
  <h1>${esc(config.title)}</h1>
  <p class="tagline">${esc(config.tagline)}</p>
</section>
${
  albums.length === 0
    ? `<section class="empty">
  <h2>No photos yet</h2>
  <p>Drop images into <code>originals/</code> — one folder per album — then run <code>npm run build</code>.</p>
</section>`
    : single
      ? grid(albums[0].photos)
      : `<section class="albums">
${albums
  .map(
    (album) => `  <a class="album-card" href="/albums/${esc(album.slug)}/" style="--tone:${esc(album.coverPhoto.color)}">
    <picture>
      ${album.coverPhoto.sources.filter((s) => s.srcset).map((s) => `<source type="${s.type}" srcset="${esc(s.srcset)}" sizes="(max-width: 700px) 92vw, 45vw">`).join('')}
      <img src="${esc(album.coverPhoto.fallback)}" alt="${esc(album.coverPhoto.alt)}" width="${album.coverPhoto.width}" height="${album.coverPhoto.height}" loading="lazy" decoding="async">
    </picture>
    <span class="album-meta">
      <span class="album-title">${esc(album.title)}</span>
      <span class="album-count">${album.photos.length} photo${album.photos.length === 1 ? '' : 's'}</span>
    </span>
  </a>`,
  )
  .join('\n')}
</section>`
}`

  return layout({
    config,
    title: config.title,
    description: config.description,
    path: '/',
    image: cover?.full,
    body,
    activeNav: 'Work',
  })
}

export function albumPage({ config, album }) {
  const body = `
<section class="page-head">
  <p class="breadcrumb"><a href="/">Work</a></p>
  <h1>${esc(album.title)}</h1>
  ${album.description ? `<p class="lede">${esc(album.description)}</p>` : ''}
  <p class="count">${album.photos.length} photo${album.photos.length === 1 ? '' : 's'}</p>
</section>
${grid(album.photos)}`

  return layout({
    config,
    title: album.title,
    description: album.description ?? `${album.title} — photographs by ${config.author}.`,
    path: `/albums/${album.slug}/`,
    image: album.coverPhoto?.full,
    body,
    activeNav: 'Work',
  })
}

export function aboutPage({ config }) {
  const body = `
<section class="page-head">
  <h1>About</h1>
</section>
<section class="prose">
  ${(config.about ?? []).map((p) => `<p>${esc(p)}</p>`).join('\n  ')}
  <p><a class="contact" href="mailto:${esc(config.email)}">${esc(config.email)}</a></p>
</section>`

  return layout({
    config,
    title: 'About',
    description: `About ${config.author} — ${config.tagline}.`,
    path: '/about/',
    body,
    activeNav: 'About',
  })
}

export function notFoundPage({ config }) {
  return layout({
    config,
    title: 'Not found',
    description: 'Page not found.',
    path: '/404.html',
    body: `
<section class="page-head">
  <h1>Not found</h1>
  <p class="lede">That page doesn't exist. <a href="/">Back to the photographs</a>.</p>
</section>`,
    activeNav: null,
  })
}

export function sitemap({ config, albums }) {
  const base = config.url.replace(/\/$/, '')
  const paths = ['/', '/about/', ...albums.map((a) => `/albums/${a.slug}/`)]
  // No <lastmod>: a build-time date changes on every run, which would make each
  // build a commit and a redeploy even when nothing about the site changed.
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${base}${p}</loc></url>`).join('\n')}
</urlset>
`
}

export function robots({ config }) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${config.url.replace(/\/$/, '')}/sitemap.xml\n`
}

export function favicon({ config }) {
  const initial = esc((config.title ?? 'P').trim().charAt(0).toUpperCase())
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0b0c0e"/>
  <text x="32" y="44" font-family="Georgia, serif" font-size="36" fill="#f2f3f4" text-anchor="middle">${initial}</text>
</svg>
`
}
