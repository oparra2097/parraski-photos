// Grid layout + lightbox. No dependencies; the page is fully usable without it
// (tiles fall back to a plain grid, and each tile links to the full image).

const grid = document.querySelector('[data-grid]')
const tiles = grid ? [...grid.querySelectorAll('[data-photo]')] : []

/* ---------- masonry ---------- */

function columnCount(element) {
  return getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length
}

function layoutMasonry() {
  if (!grid || tiles.length === 0) return
  const gap = parseFloat(getComputedStyle(grid).getPropertyValue('--gap')) || 18

  // One column is already a clean stack; masonry would only add rounding error.
  grid.classList.remove('masonry')
  for (const tile of tiles) tile.style.gridRowEnd = ''
  if (columnCount(grid) < 2) return

  grid.classList.add('masonry')
  for (const tile of tiles) {
    const height = tile.getBoundingClientRect().height
    tile.style.gridRowEnd = `span ${Math.ceil(height + gap)}`
  }
}

if (grid) {
  layoutMasonry()
  const relayout = () => requestAnimationFrame(layoutMasonry)
  new ResizeObserver(relayout).observe(grid)
  // Images with an intrinsic size that differs from the attributes (rare, but
  // possible after re-encoding) settle their height only once decoded.
  for (const img of grid.querySelectorAll('img')) {
    if (!img.complete) img.addEventListener('load', relayout, { once: true })
  }
  window.addEventListener('orientationchange', relayout)
}

/* ---------- lightbox ---------- */

if (tiles.length > 0) {
  const lightbox = document.createElement('div')
  lightbox.className = 'lightbox'
  lightbox.setAttribute('role', 'dialog')
  lightbox.setAttribute('aria-modal', 'true')
  lightbox.setAttribute('aria-label', 'Photo viewer')
  lightbox.innerHTML = `
    <div class="lightbox-stage" data-stage>
      <button class="lb-close" type="button" aria-label="Close">✕</button>
      <button class="lb-prev" type="button" aria-label="Previous photo">‹</button>
      <button class="lb-next" type="button" aria-label="Next photo">›</button>
    </div>
    <div class="lightbox-bar">
      <span class="lightbox-text">
        <span class="lightbox-title" data-title></span>
        <span class="lightbox-caption" data-caption></span>
        <span class="lightbox-exif" data-exif></span>
      </span>
      <span class="lightbox-position" data-position></span>
    </div>`
  document.body.append(lightbox)

  const stage = lightbox.querySelector('[data-stage]')
  const closeButton = lightbox.querySelector('.lb-close')
  const prevButton = lightbox.querySelector('.lb-prev')
  const nextButton = lightbox.querySelector('.lb-next')
  const titleEl = lightbox.querySelector('[data-title]')
  const captionEl = lightbox.querySelector('[data-caption]')
  const exifEl = lightbox.querySelector('[data-exif]')
  const positionEl = lightbox.querySelector('[data-position]')

  let current = -1
  let lastFocused = null
  let picture = null

  function buildPicture(tile) {
    const element = document.createElement('picture')
    for (const format of ['avif', 'webp']) {
      const srcset = tile.dataset[`srcset${format[0].toUpperCase()}${format.slice(1)}`]
      if (!srcset) continue
      const source = document.createElement('source')
      source.type = `image/${format}`
      source.srcset = srcset
      source.sizes = '100vw'
      element.append(source)
    }
    const img = document.createElement('img')
    img.src = tile.getAttribute('href')
    img.alt = tile.dataset.alt || ''
    img.width = Number(tile.dataset.width) || 0
    img.height = Number(tile.dataset.height) || 0
    img.decoding = 'async'
    element.append(img)
    return element
  }

  function preload(index) {
    const tile = tiles[index]
    if (!tile) return
    const img = new Image()
    img.sizes = '100vw'
    img.srcset = tile.dataset.srcsetAvif || tile.dataset.srcsetWebp || ''
    img.src = tile.getAttribute('href')
  }

  function show(index) {
    const tile = tiles[index]
    if (!tile) return
    current = index

    picture?.remove()
    picture = buildPicture(tile)
    stage.append(picture)

    titleEl.textContent = tile.dataset.title || ''
    captionEl.textContent = tile.dataset.caption || ''
    exifEl.textContent = tile.dataset.exif || ''
    positionEl.textContent = `${index + 1} / ${tiles.length}`
    prevButton.disabled = index === 0
    nextButton.disabled = index === tiles.length - 1

    preload(index + 1)
    preload(index - 1)
  }

  function open(index) {
    lastFocused = document.activeElement
    document.body.classList.add('lightbox-open')
    lightbox.setAttribute('data-open', '')
    show(index)
    // Hidden elements cannot take focus, so flush the pending style change
    // before moving focus into the dialog.
    void lightbox.offsetWidth
    closeButton.focus()
  }

  function close() {
    // Hand focus back to whichever photo is on screen, not the one that was
    // clicked, so arrowing through the set and closing leaves you in place.
    const target = tiles[current] ?? lastFocused
    lightbox.removeAttribute('data-open')
    document.body.classList.remove('lightbox-open')
    picture?.remove()
    picture = null
    current = -1
    target?.focus()
  }

  const step = (delta) => show(Math.min(Math.max(current + delta, 0), tiles.length - 1))

  tiles.forEach((tile, index) => {
    tile.addEventListener('click', (event) => {
      // Leave modified clicks alone so "open in new tab" still works.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
      event.preventDefault()
      open(index)
    })
  })

  closeButton.addEventListener('click', close)
  prevButton.addEventListener('click', () => step(-1))
  nextButton.addEventListener('click', () => step(1))
  stage.addEventListener('click', (event) => {
    if (event.target === stage) close()
  })

  document.addEventListener('keydown', (event) => {
    if (!lightbox.hasAttribute('data-open')) return
    if (event.key === 'Escape') close()
    else if (event.key === 'ArrowLeft') step(-1)
    else if (event.key === 'ArrowRight') step(1)
    else if (event.key === 'Tab') {
      // Keep focus inside the dialog while it is open.
      const focusable = [closeButton, prevButton, nextButton].filter((b) => !b.disabled)
      const index = focusable.indexOf(document.activeElement)
      event.preventDefault()
      const offset = event.shiftKey ? -1 : 1
      focusable[(index + offset + focusable.length) % focusable.length]?.focus()
    }
  })

  let touchStartX = 0
  lightbox.addEventListener('touchstart', (event) => { touchStartX = event.changedTouches[0].clientX }, { passive: true })
  lightbox.addEventListener('touchend', (event) => {
    const delta = event.changedTouches[0].clientX - touchStartX
    if (Math.abs(delta) > 50) step(delta < 0 ? 1 : -1)
  }, { passive: true })
}
