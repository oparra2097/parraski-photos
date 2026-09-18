# parraski.com

Photography portfolio. Plain HTML, CSS and JavaScript — no framework, no
database, nothing to patch. A small Node script turns full-resolution photos
into optimised web copies and writes the pages around them.

Running cost: the domain (~$11/yr). Hosting and TLS are free.

## Quick start

```bash
npm install                 # once
# drop photos into originals/ (see below)
npm run build               # process photos + generate the site into public/
npm run serve               # preview at http://localhost:8080
```

`npm run dev` does the last two in one go, and `npm run publish` builds,
commits and pushes in one command.

## Adding photos

Each folder inside `originals/` becomes an album. Loose files at the top level
become a single "Gallery" album, so you can start without organising anything.

```
originals/
  chamonix/
    first-light-aiguille.jpg
    DSC04812.jpg
    album.json            # optional
    captions.json         # optional
  la-grave/
    spine-wall.jpg
```

Then `npm run build`. Only new or changed photos are re-encoded — the second
build takes under a second.

Filenames become titles: `first-light-aiguille.jpg` → "First Light Aiguille".
A leading date (`2024-03-15-`) is stripped. Camera-default names like
`DSC04812` or `IMG_2201` produce no title, so name the files you care about
and leave the rest.

**`album.json`** — all keys optional:

```json
{
  "title": "Chamonix",
  "description": "Three weeks in the Mont Blanc massif, mostly before sunrise.",
  "cover": "first-light-aiguille.jpg",
  "order": 1
}
```

**`captions.json`** — per-photo overrides, keyed by filename:

```json
{
  "DSC04812.jpg": {
    "title": "Above the Mer de Glace",
    "caption": "Waiting out the wind at 3,200 m.",
    "alt": "A skier silhouetted against cloud on a rock ledge."
  }
}
```

`alt` is the description screen readers announce. It falls back to the title,
which is better than nothing but worth writing properly for your best work.

## Publishing from Lightroom

**Lightroom Classic only.** The cloud version (just "Lightroom") has
Connections rather than Publish Services and cannot do this.

No plugin needed — Lightroom Classic's built-in Hard Drive publish service
writes straight into `originals/`, and its one-level folder structure is
exactly how albums work here.

**Set it up once:**

1. Library module → **Publish Services** panel (bottom left) → **Hard Drive →
   Set Up**.
2. **Export Location** → set the folder to this repository's `originals/`.
3. **File Settings**: JPEG, quality 90, colour space **sRGB**.
4. **Image Sizing**: resize to long edge **2560 px**. The build never renders
   above 2400 px, so anything larger is wasted disk and build time.
5. **Metadata**: *Copyright & Contact Info Only*, and tick **Remove Location
   Info**. The build strips metadata anyway, but stripping at the source too
   means GPS never lands on your disk in the first place.
6. **Output Sharpening**: Screen, Standard.
7. Save, then right-click the service → **Create Published Collection** — one
   per album. Each collection becomes its own subfolder in `originals/`, so a
   collection named *Chamonix* becomes the Chamonix album.

**Then, every time:**

```
drag photos into a published collection → Publish → npm run publish
```

`npm run publish` rebuilds, commits and pushes; Cloudflare Pages deploys on
the push. Nothing else to click.

Lightroom keeps the folder in sync on its own: edit a published photo and it
moves to *Modified Photos to Republish*; remove one and it lands in *Deleted
Photos to Remove* and disappears from the folder on the next publish. The
build follows — changed files are re-encoded, removed ones have their
derivatives pruned.

Worth noting: with Lightroom in the loop, `originals/` is a **regenerable
export**, not your masters. Your RAWs and catalogue are the real originals, so
back those up — but losing `originals/` costs you one re-publish, nothing more.

## Site settings

`site.config.json` holds everything you would otherwise hunt through HTML for:
title, tagline, description, email, about text, links, and the image sizes and
formats to generate. Change it and rebuild.

## How the images work

Each photo is written at three widths (600 / 1200 / 2400 px) in both AVIF and
WebP, and the browser picks the smallest file that suits the screen. A 5 MB
camera JPEG ends up around 500 KB total across all six files — phones usually
download about 30 KB of it.

Images are never enlarged past their original size, and every `<img>` carries
its real width and height so the layout does not jump while loading.

**Your originals stay out of git** (`originals/` is ignored). Only the
compressed web copies in `public/photos/` are committed. That keeps the repo
small, but it means **this repository is not a backup of your photography** —
keep your masters on a drive and in cloud backup.

**EXIF is stripped from everything published.** Camera settings shown under a
photo are read from the master at build time and written into the page as
plain text; GPS coordinates and serial numbers never reach the web copies.

## Deploying to Cloudflare Pages

1. Push this repository to GitHub.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to
   Git**, and pick this repo.
3. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: **`public`**

   `public/` is committed, so Cloudflare only has to serve it — no build step
   to break, and deploys take seconds.
4. **Custom domains → Set up a domain** → `parraski.com`. If the domain is
   registered at Cloudflare the DNS records are created for you.

Every `git push` redeploys — `npm run publish` does the build, commit and push
in one command. Cloudflare Pages' free tier has no bandwidth cap.

GitHub Pages also works (point it at `/public` on `main`), but its ~1 GB site
limit and 100 GB/month soft bandwidth limit are worth knowing about for a
gallery this size.

## Maintenance

There is essentially none — that is the point of building it this way. Two
things actually matter:

- **Keep domain auto-renew on.** Letting the domain lapse is the most common
  way people lose a site.
- **Back up `originals/`.** The site holds compressed derivatives; they will
  not reconstruct your masters.

Re-encoding every photo (`npm run rebuild`) rewrites every file in
`public/photos/`, and git keeps both copies forever. Settle on your image
settings early and avoid wholesale re-encodes.

## Layout

```
originals/        full-resolution masters (not committed)
src/css/          stylesheet
src/js/           gallery + lightbox
src/static/       files copied verbatim into the site (_headers, etc.)
scripts/          build pipeline
public/           the generated site — this is what gets deployed
site.config.json  titles, contact details, image sizes
```
