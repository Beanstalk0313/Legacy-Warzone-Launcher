// Launcher soundtrack manager — plays the current game mode's music at a
// quiet background level. The soundtrack is GLOBAL: it keeps playing while
// the user returns to the launcher main menu (the interface unmounts but the
// audio element lives here), and switching to a different mode crossfades —
// the old track fades out over 5 seconds while the new one fades in over
// the same window. Calling playModeMusic() with the same track is a no-op.
//
// Zombies mode has TWO tracks: the default zombies_default.mp3 and the
// classic Black Ops soundtrack (zombies_bo1.mp3), chosen by the "Zombies
// Classic Soundtrack" toggle in Options (shown only in zombies mode).
//
// Music is independent of Silent Mode (which only mutes launcher SFX) —
// it has its own Music toggle in Options > SOUND.
import multiplayerTrack from '../assets/multiplayer.mp3'
import warzoneTrack from '../assets/warzone.mp3'
import zombiesDefaultTrack from '../assets/zombies_default.mp3'
import zombiesClassicTrack from '../assets/zombies_bo1.mp3'

// Map of game mode → its default soundtrack asset.
const MODE_TRACKS = {
  multiplayer: multiplayerTrack,
  warzone: warzoneTrack,
  zombies: zombiesDefaultTrack,
}

// Background music — intentionally very quiet so the launcher SFX and the
// game's own audio stay audible on top of it.
const TARGET_VOLUME = 0.1
// Mode switches crossfade: old track fades out over 5 s while the new one
// fades in over the same window (per product spec).
const CROSSFADE_MS = 5000
// Turning Music on/off in Options uses a quicker fade — a 5 s ramp on a
// toggle feels unresponsive.
const QUICK_FADE_MS = 1000
// Joining/hosting a match ducks the soundtrack out so the game's audio is
// unobstructed (and fades it back in when the server is left / closed).
const DUCK_FADE_MS = 2000
// Volume animation step granularity.
const FADE_STEP_MS = 50

// Every audio element the manager has ever created, keyed by track key
// ('multiplayer' | 'warzone' | 'zombies' | 'zombies:classic'). Elements
// that finish fading out are released (paused + src cleared) and removed.
const elements = new Map()
// In-flight fade intervals — cleared at the start of every transition so a
// new request (mode switch, toggle) takes over cleanly.
const fadeIntervals = new Set()
// True while the soundtrack is ducked (the user is joining or hosting a
// match). Ducking forces the active track to volume 0; it comes back with
// restoreModeMusic(). playModeMusic() respects the flag so a settings
// change mid-join can't un-duck the music.
let ducked = false

/** Cancel every in-flight fade. Elements stay wherever their volume is. */
function clearFades() {
  for (const id of fadeIntervals) window.clearInterval(id)
  fadeIntervals.clear()
}

/** Pause + release an audio element's resource. */
function release(audio) {
  try {
    audio.pause()
    audio.src = ''
  } catch {
    // Fail-safe
  }
}

/**
 * Animate an element's volume from `from` to `to` over `ms`, calling
 * `onDone` when finished (or immediately when there is nothing to fade).
 */
function fadeVolume(audio, from, to, ms, onDone) {
  if (!audio) {
    onDone?.()
    return
  }
  const steps = Math.max(1, Math.round(ms / FADE_STEP_MS))
  const delta = (to - from) / steps
  let step = 0
  const id = window.setInterval(() => {
    step += 1
    try {
      audio.volume = Math.max(0, Math.min(1, from + delta * step))
    } catch {
      // Fail-safe
    }
    if (step >= steps) {
      window.clearInterval(id)
      fadeIntervals.delete(id)
      onDone?.()
    }
  }, FADE_STEP_MS)
  fadeIntervals.add(id)
}

/**
 * Start (or switch) the soundtrack for the given game mode.
 *
 * @param {object} options
 * @param {'multiplayer'|'warzone'|'zombies'} options.mode - the active mode
 * @param {boolean} [options.enabled=true] - false (Options > Music off) fades music out
 * @param {boolean} [options.zombiesClassic=false] - zombies mode: use the
 *   classic Black Ops soundtrack instead of the default zombies track
 */
export function playModeMusic({ mode = 'multiplayer', enabled = true, zombiesClassic = false }) {
  const trackKey = mode === 'zombies' && zombiesClassic ? 'zombies:classic' : mode
  // The volume a track should sit at once its fade settles — 0 while the
  // soundtrack is ducked (joining/hosting a match) so a settings change or
  // mode switch mid-join never un-mutes the background music.
  const desiredVolume = ducked ? 0 : TARGET_VOLUME
  // Any request supersedes the previous one — cancel in-flight fades so a
  // mid-crossfade switch starts cleanly.
  clearFades()

  // Music disabled (Options > Music off): fade out whatever is playing.
  if (!enabled) {
    for (const [key, audio] of elements) {
      fadeVolume(audio, audio.volume, 0, QUICK_FADE_MS, () => {
        release(audio)
        elements.delete(key)
      })
    }
    return
  }

  // Crossfade out every element that isn't the requested track — the old
  // song fades to silence over CROSSFADE_MS while the new one fades in
  // below, so the two overlap instead of cutting.
  for (const [key, audio] of elements) {
    if (key === trackKey) continue
    fadeVolume(audio, audio.volume, 0, CROSSFADE_MS, () => {
      release(audio)
      elements.delete(key)
    })
  }

  const audio = elements.get(trackKey)
  if (audio && !audio.paused) {
    // Same track already playing — bring it to the desired volume (covers
    // a paused-at-zero re-enable after Music was toggled off, and keeps it
    // silent while ducked).
    if (Math.abs(audio.volume - desiredVolume) > 0.001) {
      fadeVolume(audio, audio.volume, desiredVolume, ducked ? DUCK_FADE_MS : QUICK_FADE_MS)
    }
    return
  }
  if (audio) {
    // Paused (faded out earlier) — resume and fade back in.
    try {
      audio.volume = 0
      audio.play().catch(() => {})
    } catch {
      // Fail-safe
    }
    fadeVolume(audio, 0, desiredVolume, ducked ? DUCK_FADE_MS : QUICK_FADE_MS)
    return
  }

  // Brand-new track: start silent and fade in with the crossfade window so
  // a mode switch builds up the new music as the old one dies down.
  try {
    const src = trackKey === 'zombies:classic' ? zombiesClassicTrack : MODE_TRACKS[mode]
    if (!src) return
    const next = new Audio(src)
    next.loop = true
    next.volume = 0
    // Autoplay policy (browser dev): if play() rejects, the element just
    // stays silent until a user gesture.
    next.play().catch(() => {})
    elements.set(trackKey, next)
    fadeVolume(next, 0, desiredVolume, ducked ? DUCK_FADE_MS : CROSSFADE_MS)
  } catch {
    // Fail-safe for audio context errors
  }
}

/**
 * Duck the soundtrack out — called when the user starts joining or hosting
 * a match so the launcher music doesn't fight the game's audio. Fades every
 * active track to silence; restoreModeMusic() brings it back.
 */
export function duckModeMusic() {
  if (ducked) return
  ducked = true
  clearFades()
  for (const [, audio] of elements) {
    fadeVolume(audio, audio.volume, 0, DUCK_FADE_MS)
  }
}

/**
 * Restore the soundtrack after ducking — called when the user leaves the
 * server or closes a hosted match (or the join/host flow is cancelled).
 * Fades every active track back up to its normal background volume.
 */
export function restoreModeMusic() {
  if (!ducked) return
  ducked = false
  clearFades()
  for (const [, audio] of elements) {
    if (audio.paused) continue
    fadeVolume(audio, audio.volume, TARGET_VOLUME, DUCK_FADE_MS)
  }
}

/** Stop every track immediately and release all elements. */
export function stopModeMusic() {
  clearFades()
  for (const [, audio] of elements) release(audio)
  elements.clear()
}
