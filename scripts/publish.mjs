#!/usr/bin/env node
// Commits the generated site and pushes it. Cloudflare Pages deploys on push,
// so this is the whole "put it online" step. Run via `npm run publish`, which
// builds first.

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// stderr is captured rather than inherited: the upstream probe below is allowed
// to fail, and its git error should not surface as alarming output.
const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

async function summary() {
  try {
    const manifest = JSON.parse(await readFile(path.join(ROOT, 'public', 'photos.json'), 'utf8'))
    const photos = manifest.albums.reduce((sum, album) => sum + album.photos.length, 0)
    const albums = manifest.albums.length
    return `Update gallery — ${photos} photo${photos === 1 ? '' : 's'} in ${albums} album${albums === 1 ? '' : 's'}`
  } catch {
    return 'Update gallery'
  }
}

try {
  git('add', '-A')

  // --quiet exits non-zero when there is something staged, which is what we want
  // to detect; execFileSync throws in that case.
  let hasChanges = false
  try {
    git('diff', '--cached', '--quiet')
  } catch {
    hasChanges = true
  }

  if (hasChanges) {
    const staged = git('diff', '--cached', '--name-only').split('\n').filter(Boolean).length
    git('commit', '-m', await summary())
    console.log(`Committed ${staged} changed file(s).`)
  }

  // A clean tree does not mean there is nothing to send: earlier commits may
  // still be sitting unpushed, and those are what the live site is missing.
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  let unpushed = 1
  try {
    unpushed = Number(git('rev-list', '--count', '@{upstream}..HEAD'))
  } catch {
    unpushed = 1 // no upstream yet — push to create it
  }

  if (!hasChanges && unpushed === 0) {
    console.log('Nothing to publish — the site is already up to date.')
    process.exit(0)
  }

  git('push', 'origin', branch)
  console.log(`Pushed to ${branch}. Cloudflare Pages will deploy in a moment.`)
} catch (error) {
  const detail = error.stderr?.toString().trim() || error.message
  console.error(`\nPublish failed: ${detail}`)
  process.exitCode = 1
}
