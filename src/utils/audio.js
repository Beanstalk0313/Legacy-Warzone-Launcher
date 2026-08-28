import hoverSfx from '../assets/hover.mp3'
import selectSfx from '../assets/select.mp3'
import quitSfx from '../assets/quit.mp3'
import playerJoinSfx from '../assets/player_join.mp3'
// Sound map: cue name → Vite-bundled asset URL.
// Audio uses Vite imports directly (not localAssetUrl) because
// convertFileSrc URLs don't work with new Audio() in Tauri's WebView.
const soundMap = {
  jupHover: hoverSfx,
  jupSelect: selectSfx,
  jupQuit: quitSfx,
  playerJoin: playerJoinSfx,
}

const lastPlayedAt = new Map()
const duplicateGuardMs = {
  jupSelect: 160,
  jupQuit: 160,
  // Hovers were previously unguarded: with controller-arrow polling firing
  // onMove every frame, holding a direction could spam hover sounds. Throttle
  // at ~60ms so the cue still feels responsive without overlapping itself.
  jupHover: 60,
  // Player-join cue: fires on a genuinely new server_members row (the
  // known-set detection in the roster polls already dedupes arrivals), so
  // the guard is just belt-and-suspenders against a double-fire. Short
  // enough that two people joining in the same poll tick both chime.
  playerJoin: 500,
}

// Silent Mode (Options > Silent Mode) is a master mute that short-circuits
// playSound() before anything else.
let silentMode = false

export function setSilentMode(enabled) {
  silentMode = Boolean(enabled)
}

export function playSound(soundName, volume = 0.5) {
  try {
    // Silent Mode (Options > Silent Mode): mute every launcher SFX.
    if (silentMode) return

    const src = soundMap[soundName]
    if (!src) return

    // Guard against repeat events stacking the same cue.
    const now = performance.now()
    const lastTime = lastPlayedAt.get(soundName) || 0
    if (now - lastTime < (duplicateGuardMs[soundName] || 0)) return
    lastPlayedAt.set(soundName, now)

    const audio = new Audio(src)
    audio.volume = volume
    audio.play().catch(() => {
      // Ignore autoplay browser policies
    })
  } catch (e) {
    // Fail-safe for audio context errors
  }
}
