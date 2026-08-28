import React, { useRef, useState } from 'react'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { useGlyphPlatform, glyphSrc } from '../utils/glyphs'
import logoBig from '../assets/logo_big.png'

// ── Platform glyphs ─────────────────────────────────────────────────────────
// Button artwork comes from the src/assets/glyphs/<Platform>/ packs. The
// platform is detected from the connected controller (or picked manually in
// Options > Controller Glyphs) — see utils/glyphs.js.

function ConfirmGlyph({ platform }) {
  return <img className="glyph-img launcher-glyph-img" src={glyphSrc(platform, 'confirm')} alt="" aria-hidden="true" />
}

function BackGlyph({ platform }) {
  return <img className="glyph-img launcher-glyph-img" src={glyphSrc(platform, 'back')} alt="" aria-hidden="true" />
}

// ── SVG icon for the bottom bar ──────────────────────────────────────────────
function PowerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  )
}

// The three game modes, in on-screen order (top → bottom).
const GAME_MODES = [
  { id: 'warzone', label: 'Warzone' },
  { id: 'zombies', label: 'Zombies' },
  { id: 'multiplayer', label: 'Multiplayer' },
]

export default function Launcher({ onSelectMod, expandingMod = null, collapsingMod = null, navDisabled = false, onQuitClick }) {
  const { glyphPlatform } = useGlyphPlatform()
  const [inputMode, setInputMode] = useState('mouse')
  const inputModeRef = useRef('mouse')
  // The mode whose button was just pressed — wears the .is-launching accent
  // flash while the 480 ms launch choreography hands off to the game view.
  const [launchingMode, setLaunchingMode] = useState(null)

  const setCurrentInputMode = (mode) => {
    inputModeRef.current = mode
    setInputMode(mode)
  }

  const handleMouseMove = (event) => {
    if (event.movementX !== 0 || event.movementY !== 0) {
      setCurrentInputMode('mouse')
    }
  }

  const handleHoverButton = () => {
    if (inputModeRef.current === 'controller') return
    playSound('jupHover')
  }

  const handleSelectMode = (mode) => {
    if (launchingMode) return // a launch is already in flight
    setLaunchingMode(mode)
    playSound('jupSelect')
    onSelectMod(mode)
  }

  // The quit button opens the shared confirmation modal (owned by App —
  // the same one the window X opens); App performs the actual quit.
  const handleQuitClick = () => {
    playSound('jupSelect')
    onQuitClick?.()
  }

  const handleControllerMove = () => {
    setCurrentInputMode('controller')
  }

  const focusedButtonIndex = useControllerNavigation({
    // Three mode buttons, moved through with up/down.
    itemCount: GAME_MODES.length,
    allowedDirections: ['up', 'down'],
    repeat: false,
    // navDisabled: the startup auto-update modal is open — its own hook
    // owns navigation, so the launcher's hook goes quiet (no double-fire).
    enabled: !expandingMod && !collapsingMod && !navDisabled,
    onNavigate: (direction, currentIndex) => {
      if (direction === 'up') return Math.max(0, currentIndex - 1)
      if (direction === 'down') return Math.min(GAME_MODES.length - 1, currentIndex + 1)
      return currentIndex
    },
    onConfirm: (index) => {
      setCurrentInputMode('controller')
      const mode = GAME_MODES[index]
      if (mode) handleSelectMode(mode.id)
    },
    onMove: handleControllerMove,
  })

  const containerClassName = [
    'launcher-container',
    inputMode === 'controller' ? 'controller-mode' : '',
    expandingMod ? 'is-expanding' : '',
    collapsingMod ? 'is-collapsing' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={containerClassName}
      onMouseMove={handleMouseMove}
    >
      {/* Big MWIII logo — top left */}
      <img src={logoBig} alt="Modern Warfare III" className="launcher-logo" />

      {/* Game mode buttons — left side, vertically centered */}
      <div className="launcher-mode-stack">
        {GAME_MODES.map((mode, index) => (
          <button
            key={mode.id}
            className={`btn-launcher-mode ${launchingMode === mode.id ? 'is-launching' : ''} ${inputMode === 'controller' && focusedButtonIndex === index ? 'controller-focused' : ''}`}
            onClick={() => handleSelectMode(mode.id)}
            onMouseEnter={handleHoverButton}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* Bottom bar — quit */}
      <div className="launcher-bottom-bar">
        <button
          className="launcher-bottom-bar-btn"
          onClick={handleQuitClick}
          onMouseEnter={handleHoverButton}
          title="Quit to Desktop"
        >
          <PowerIcon />
          <span>QUIT</span>
        </button>
      </div>

      {inputMode === 'controller' && (
        <div className="controller-hints" aria-label="Controller controls">
          <span><ConfirmGlyph platform={glyphPlatform} /> Select</span>
          <span><BackGlyph platform={glyphPlatform} /> Back</span>
        </div>
      )}
    </div>
  )
}
