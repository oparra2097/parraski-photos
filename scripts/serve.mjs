#!/usr/bin/env node
// Minimal static server for previewing public/ locally. Not used in production —
// Cloudflare Pages serves the same directory.

import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
const PORT = Number(process.env.PORT ?? 8080)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
}

async function resolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  const candidate = path.join(ROOT, path.normalize(decoded).replace(/^(\.\.[/\\])+/, ''))
  if (!candidate.startsWith(ROOT)) return null
  for (const file of [candidate, path.join(candidate, 'index.html')]) {
    try {
      if ((await stat(file)).isFile()) return file
    } catch {
      /* try next */
    }
  }
  return null
}

createServer(async (req, res) => {
  const file = await resolve(req.url ?? '/')
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    createReadStream(path.join(ROOT, '404.html')).on('error', () => res.end('Not found')).pipe(res)
    return
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}).listen(PORT, () => console.log(`Preview: http://localhost:${PORT}`))
