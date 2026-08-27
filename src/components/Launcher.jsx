import React, { useRef, useState } from 'react'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { useGlyphPlatform, glyphSrc } from '../utils/glyphs'
import { destroyAppWithServerCleanup } from '../utils/serverPresence'
import jupLogo from '../assets/jup_logo.png'
import iw8Logo from '../assets/iw8_logo.png'

// ── Platform glyphs ─────────────────────────────────────────────────────────
// Button artwork comes from the src/assets/glyphs/<Platform>/ packs. The
// platform is detected from the connected controller (or picked manually in
// Options > Controller Glyphs) — see utils/glyphs.js.

function NavigateGlyph({ platform }) {
  return <img className="glyph-img launcher-glyph-img" src={glyphSrc(platform, 'navigate')} alt="" aria-hidden="true" />
}

function ConfirmGlyph({ platform }) {
  return <img className="glyph-img launcher-glyph-img" src={glyphSrc(platform, 'confirm')} alt="" aria-hidden="true" />
}

function BackGlyph({ platform }) {
  return <img className="glyph-img launcher-glyph-img" src={glyphSrc(platform, 'back')} alt="" aria-hidden="true" />
}

// ── SVG icons for the bottom bar ─────────────────────────────────────────────
function PowerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  )
}

// localStorage key for persisting the last launched mod theme
const LAST_MOD_KEY = 'lwz-last-mod'

// Build-time flag — set VITE_JUPITER_ONLY=true (see .env.jupiter, enabled
// via `npm run dev:jupiter` / `npm run build:jupiter` / the tauri:*.jupiter
// variants). When true, the launcher renders ONLY the Warzone III (Jupiter)
// tile at full width — there is no IW8 option on the main menu at all.
const JUPITER_ONLY = import.meta.env.VITE_JUPITER_ONLY === 'true'

function getLastMod() {
  if (JUPITER_ONLY) return 'jupiter'
  try {
    return window.localStorage.getItem(LAST_MOD_KEY) || 'iw8'
  } catch { return 'iw8' }
}

export default function Launcher({ onSelectMod, expandingMod = null, collapsingMod = null, navDisabled = false }) {
  const { glyphPlatform } = useGlyphPlatform()
  const [inputMode, setInputMode] = useState('mouse')
  const inputModeRef = useRef('mouse')
  const [lastMod, setLastMod] = useState(getLastMod)

  const setCurrentInputMode = (mode) => {
    inputModeRef.current = mode
    setInputMode(mode)
  }

  const handleMouseMove = (event) => {
    if (event.movementX !== 0 || event.movementY !== 0) {
      setCurrentInputMode('mouse')
    }
  }

  const handleHoverSide = () => {
    if (inputModeRef.current === 'controller') return
    playSound('mainSlide', 0.4)
  }

  const handleHoverJupButton = (e) => {
    e.stopPropagation()
    if (inputModeRef.current === 'controller') return
    playSound('jupHover')
  }

  const handleHoverIW8Button = (e) => {
    e.stopPropagation()
    if (inputModeRef.current === 'controller') return
    playSound('iw8Hover')
  }

  const handleSelectJupiter = (e, gameMode) => {
    e?.stopPropagation()
    playSound('jupSelect')
    try { window.localStorage.setItem(LAST_MOD_KEY, 'jupiter') } catch {}
    setLastMod('jupiter')
    onSelectMod('jupiter', gameMode || 'multiplayer')
  }

  const handleSelectIW8 = (e) => {
    e?.stopPropagation()
    playSound('iw8Select')
    try { window.localStorage.setItem(LAST_MOD_KEY, 'iw8') } catch {}
    setLastMod('iw8')
    onSelectMod('iw8')
  }

  const handleQuitDesktop = async () => {
    playSound(lastMod === 'jupiter' ? 'jupSelect' : 'iw8Select')
    try {
      await destroyAppWithServerCleanup()
    } catch (err) {
      console.warn('[quit] destroy() failed; falling back to window.close()', err)
      try { window.close() } catch { /* nothing more we can do */ }
    }
  }

  const handleControllerMove = () => {
    setCurrentInputMode('controller')
    playSound('mainSlide', 0.4)
  }

  const focusedButtonIndex = useControllerNavigation({
    // In a Jupiter-only build there is a single (full-screen) tile, so the
    // controller focus is locked to index 0 and left/right movement is
    // disabled entirely.
    itemCount: JUPITER_ONLY ? 1 : 2,
    allowedDirections: JUPITER_ONLY ? [] : ['left', 'right'],
    repeat: false,
    // navDisabled: the startup auto-update modal is open — its own hook
    // owns navigation, so the launcher's hook goes quiet (no double-fire).
    enabled: !expandingMod && !collapsingMod && !navDisabled,
    onNavigate: JUPITER_ONLY
      ? () => 0
      : (direction, currentIndex) => {
          if (direction === 'left') return Math.max(0, currentIndex - 1)
          if (direction === 'right') return Math.min(1, currentIndex + 1)
          return currentIndex
        },
    onConfirm: (index) => {
      setCurrentInputMode('controller')
      if (JUPITER_ONLY || index === 0) handleSelectJupiter()
      if (!JUPITER_ONLY && index === 1) handleSelectIW8()
    },
    onMove: handleControllerMove,
  })

  const containerClassName = [
    'launcher-container',
    JUPITER_ONLY ? 'launcher-jupiter-only' : '',
    inputMode === 'controller' ? 'controller-mode' : '',
    expandingMod ? `is-expanding-${expandingMod}` : '',
    collapsingMod ? `is-collapsing-${collapsingMod}` : '',
  ].filter(Boolean).join(' ')

  const themeClass = lastMod === 'jupiter' ? 'jupiter-theme' : 'iw8-theme'

  return (
    <div
      className={containerClassName}
      onMouseMove={handleMouseMove}
    >
      {/* Left Side: WARZONE III (Jupiter Mod) */}
      <div
        className={`launcher-split jupiter-side ${inputMode === 'controller' && focusedButtonIndex === 0 ? 'controller-focused' : ''}`}
        onMouseEnter={handleHoverSide}
      >
        <img src={jupLogo} alt="Warzone III" className="launcher-logo" />

        <div className="launcher-button-stack">
          <button
            className="btn-launcher-play-jupiter"
            onClick={(e) => handleSelectJupiter(e, 'warzone')}
            onMouseEnter={handleHoverJupButton}
          >
            Warzone
          </button>
          <button
            className="btn-launcher-play-jupiter"
            onClick={(e) => handleSelectJupiter(e, 'zombies')}
            onMouseEnter={handleHoverJupButton}
          >
            Zombies
          </button>
          <button
            className={`btn-launcher-play-jupiter ${inputMode === 'controller' && focusedButtonIndex === 0 ? 'controller-focused' : ''}`}
            onClick={(e) => handleSelectJupiter(e, 'multiplayer')}
            onMouseEnter={handleHoverJupButton}
          >
            Multiplayer
          </button>
        </div>
      </div>

      {/* Right Side: WARZONE 1 (IW8 Mod) — omitted entirely in a
          Jupiter-only build (VITE_JUPITER_ONLY=true): the Jupiter tile
          above already fills the whole screen. */}
      {!JUPITER_ONLY && (
        <div
          className={`launcher-split iw8-side ${inputMode === 'controller' && focusedButtonIndex === 1 ? 'controller-focused' : ''}`}
          onMouseEnter={handleHoverSide}
        >
          <img src={iw8Logo} alt="Warzone 1" className="launcher-logo" />

          <div className="launcher-button-wrapper">
            <button
              className={`btn-launcher-play-iw8 ${inputMode === 'controller' && focusedButtonIndex === 1 ? 'controller-focused' : ''}`}
              onClick={handleSelectIW8}
              onMouseEnter={handleHoverIW8Button}
            >
              Play
            </button>
          </div>
        </div>
      )}

      {/* Bottom bar — quit */}
      <div className="launcher-bottom-bar">
        <button
          className={`launcher-bottom-bar-btn ${themeClass}`}
          onClick={handleQuitDesktop}
          onMouseEnter={() => playSound(lastMod === 'jupiter' ? 'jupHover' : 'iw8Hover')}
          title="Quit to Desktop"
        >
          <PowerIcon />
        </button>
      </div>

      {inputMode === 'controller' && (
        <div className="controller-hints" aria-label="Controller controls">
          {/* No Navigate hint in a Jupiter-only build — nothing to
              move between. */}
          {!JUPITER_ONLY && <span><NavigateGlyph platform={glyphPlatform} /> Navigate</span>}
          <span><ConfirmGlyph platform={glyphPlatform} /> Select</span>
          <span><BackGlyph platform={glyphPlatform} /> Back</span>
        </div>
      )}
    </div>
  )
}
