// One-shot helper: boost the IW8 sound effects by +20% (volume=1.2) so
// they sit louder relative to the Jupiter/main-slide cues. Run once; do
// not commit. Uses the libmp3lame encoder at q:a 2 (VBR ~190 kbit) for a
// transparent re-encode.
//
// Usage: node scripts/boost-iw8-audio.mjs
//
// Safe to re-run: each invocation reads the file, applies the +20% gain
// relative to the current loudness, and writes back. After running it once
// you'll have actually boosted by ~44% from the original (1.2 × 1.2). If
// you want a single, non-accumulating boost, restore from source first.

import { execFileSync } from 'node:child_process'
import { renameSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ffmpegPath from 'ffmpeg-static'

const here = path.dirname(fileURLToPath(import.meta.url))
const assetsDir = path.resolve(here, '..', 'src', 'assets')

const targets = ['iw8_hover.mp3', 'iw8_select.mp3']
const gain = 1.2 // +20% amplitude

for (const file of targets) {
  const src = path.join(assetsDir, file)
  const tmp = `${src}.tmp.mp3`
  console.log(`\n[+] boosting ${file} by ${Math.round((gain - 1) * 100)}% (×${gain})`)
  // Write to a sibling temp path first so ffmpeg never reads from and
  // writes to the same inode (avoids partial files if something fails).
  execFileSync(
    ffmpegPath,
    [
      '-y',
      '-loglevel', 'error',
      '-i', src,
      '-af', `volume=${gain}`,
      '-c:a', 'libmp3lame',
      '-q:a', '2',
      tmp,
    ],
    { stdio: 'inherit' },
  )
  renameSync(tmp, src)
  console.log(`[+] ${file} written`)
}

console.log('\ndone.')
