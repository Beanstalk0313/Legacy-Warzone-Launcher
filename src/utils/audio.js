import iw8HoverSfx from '../assets/iw8_hover.mp3'
import iw8SelectSfx from '../assets/iw8_select.mp3'
import iw8QuitSfx from '../assets/iw8_quit.mp3'
import jupHoverSfx from '../assets/jup_hover.mp3'
import jupSelectSfx from '../assets/jup_select.mp3'
import jupQuitSfx from '../assets/jup_quit.mp3'
import mainSlideSfx from '../assets/main_slide.mp3'
import playerJoinSfx from '../assets/player_join.mp3'
// Sound map: cue name → Vite-bundled asset URL.
// Audio uses Vite imports directly (not localAssetUrl) because
// convertFileSrc URLs don't work with new Audio() in Tauri's WebView.
const soundMap = {
  iw8Hover: iw8HoverSfx,
  iw8Select: iw8SelectSfx,
  iw8Quit: iw8QuitSfx,
  jupHover: jupHoverSfx,
  jupSelect: jupSelectSfx,
  jupQuit: jupQuitSfx,
  mainSlide: mainSlideSfx,
  playerJoin: playerJoinSfx,
}

const lastPlayedAt = new Map()
const duplicateGuardMs = {
  mainSlide: 160,
  iw8Select: 160,
  jupSelect: 160,
  iw8Quit: 160,
  jupQuit: 160,
  // Hovers were previously unguarded: with controller-arrow polling firing
  // onMove every frame, holding a direction could spam hover sounds. Throttle
  // at ~60ms so the cue still feels responsive without overlapping itself.
  iw8Hover: 60,
  jupHover: 60,
  // Player-join cue: fires on a genuinely new server_members row (the
  // known-set detection in the roster polls already dedupes arrivals), so
  // the guard is just belt-and-suspenders against a double-fire. Short
  // enough that two people joining in the same poll tick both chime.
  playerJoin: 500,
}

// Dynamic Sound Effects (Options > Dynamic Sounds): remaps every theme cue
// to the other mod's file when set to 'iw8' / 'jupiter'. 'enabled' (default)
// leaves cues as the calling theme intends. Shared cues (mainSlide) are
// never remapped. Silent Mode (Options > Silent Mode) is a master mute that
// short-circuits playSound() before anything else — overriding the whole
// remap, not just one theme.
let soundOverride = 'enabled' // 'enabled' | 'iw8' | 'jupiter'
let silentMode = false

export function setSilentMode(enabled) {
  silentMode = Boolean(enabled)
}

const soundRemap = {
  iw8: { jupHover: 'iw8Hover', jupSelect: 'iw8Select', jupQuit: 'iw8Quit' },
  jupiter: { iw8Hover: 'jupHover', iw8Select: 'jupSelect', iw8Quit: 'jupQuit' },
}

export function setSoundOverride(mode) {
  soundOverride = mode === 'iw8' || mode === 'jupiter' ? mode : 'enabled'
}

function resolveCue(soundName) {
  if (soundOverride === 'enabled') return soundName
  return soundRemap[soundOverride][soundName] || soundName
}

/**
 * Resolve the URL for a cue via the sound override remap.
 */
function cueSrc(cueName) {
  const resolved = resolveCue(cueName)
  return soundMap[resolved]
}

export function playSound(soundName, volume = 0.5) {
  try {
    // Silent Mode (Options > : mute every launcher SFX.
    if (silentMode) return

    // Guard against the duplicate map by the ORIGINAL cue name so a hover
    // throttle can't be bypassed by switching the override mid-spam.
    const guardedName = soundName
    const src = cueSrc(soundName)
    if (!src) return

    const now = performance.now()
    const lastTime = lastPlayedAt.get(guardedName) || 0
    if (now - lastTime < (duplicateGuardMs[guardedName] || 0)) return
    lastPlayedAt.set(guardedName, now)

    const audio = new Audio(src)
    audio.volume = volume
    audio.play().catch(() => {
      // Ignore autoplay browser policies
    })
  } catch (e) {
    // Fail-safe for audio context errors
  }
}
