import React, { useEffect, useState } from 'react'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'

const guidedSteps = [
  'In the PHA Client, click Local Play.',
  'Click Create Local Game.',
  'Return to the Warzone Legacy Launcher and click Continue.',
]

export default function JupiterJoinModal({
  theme = 'jupiter',
  stage,
  serverName,
  onContinue,
  onFinish,
  onRetry,
}) {
  // `theme` is the SHELL style: in an IW8 shell (Dynamic Interfaces = IW8
  // Mod) the modal keeps its layout but wears IW8 accent colors + sounds.
  const isJupiter = theme === 'jupiter'
  const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'
  const [inputMode, setInputMode] = useState('mouse')
  const isGuided = stage === 'guided'
  const isSending = stage === 'sending'
  const isResult = stage === 'result'
  const buttonCount = isGuided || isSending ? 1 : 2

  useEffect(() => {
    setInputMode('mouse')
  }, [stage])

  const handleHover = () => playSound(hoverSound)
  const handleSelect = (callback) => {
    playSound(selectSound)
    callback?.()
  }

  const handlePrimary = () => {
    if (isGuided) handleSelect(onContinue)
    else handleSelect(onFinish)
  }

  // Retry re-runs the config + connect (the game is already in the local
  // lobby — no prep needed). Same themed hover as every other button.
  const handleSecondary = () => handleSelect(onRetry)

  const focusedIndex = useControllerNavigation({
    itemCount: buttonCount,
    allowedDirections: ['up', 'down'],
    enabled: Boolean(stage) && !isSending,
    onControllerActivity: () => setInputMode('controller'),
    onMove: () => {
      setInputMode('controller')
      handleHover()
    },
    onConfirm: (index) => {
      if (index === 0) handlePrimary()
      else handleSecondary()
    },
  })

  if (!stage) return null

  const title = isGuided
    ? `PREPARE TO JOIN ${serverName}`
    : isSending
      ? 'DEPLOYING LOCAL GAME'
      : 'CHECK YOUR GAME WINDOW'

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className={`jupiter-join-modal ${isJupiter ? '' : 'iw8-styled'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="jupiter-join-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="jupiter-join-accent-bar" />
        <div className="jupiter-join-content">
          <span className="jupiter-join-kicker">LOCAL PLAY DEPLOYMENT</span>
          <h2 id="jupiter-join-title">{title}</h2>

          {isGuided && (
            <>
              <p className="jupiter-join-intro">The launcher has prepared Jupiter. Complete these steps, then continue so the map, mode, and LAN session can be sent to the game.</p>
              <ol className="jupiter-join-steps">
                {guidedSteps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </>
          )}

          {isSending && (
            <p className="jupiter-join-intro">Sending the selected map and mode configuration, then connecting to the LAN session. Keep the game open.</p>
          )}

          {isResult && (
            <p className="jupiter-join-intro">Check the Jupiter game window to see whether it entered the selected local game. If it did not, choose Retry to send the configuration again.</p>
          )}

          <div className="jupiter-join-actions">
            {isResult && (
              <button
                type="button"
                className={`jupiter-join-button ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={() => handleSelect(onFinish)}
              >
                Finish
              </button>
            )}
            {isResult && (
              <button
                type="button"
                className={`jupiter-join-button secondary ${inputMode === 'controller' && focusedIndex === 1 ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={handleSecondary}
              >
                Retry
              </button>
            )}
            {isGuided && (
              <button
                type="button"
                className={`jupiter-join-button ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={handlePrimary}
              >
                Continue
              </button>
            )}
            {isSending && <span className="jupiter-join-sending">Working…</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
