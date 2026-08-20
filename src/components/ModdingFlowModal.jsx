import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'

// Multi-stage guided modal for the Modding tab's RTM flows (Loadout and
// Operator Editing / Loadout Display Bug Fix). Reuses the host-prompt
// modal's surface (jupiter-host-prompt-modal + jupiter-join-* inner
// classes) so both themes come for free:
//
//   stage 'ask'          → "ARE YOU IN A WARZONE LOBBY?" Yes / No (Yes =
//                          already in a lobby → skip the prep sequence)
//   stage 'working'      → spinner + Cancel while an RTM step runs
//   stage 'guided'       → PHA Client steps (Local Play → Create Local
//                          Game) with a Continue button
//   stage 'instruction'  → flow-specific instructions + Finish/Continue
//
// Esc / controller-B cancels the whole flow at any stage (no side effects).
const guidedSteps = [
  'In the PHA Client, click Local Play.',
  'Click Create Local Game.',
  'Return to the Warzone Legacy Launcher and click Continue.',
]

export default function ModdingFlowModal({
  theme = 'jupiter',
  stage, // null (closed) | 'ask' | 'working' | 'guided' | 'instruction'
  copy, // per-flow strings: { askIntro, workingIntro, instructionTitle, instructionBody, instructionButton }
  onYes, // ask Yes → skip prep
  onNo, // ask No → run prep
  onContinue, // guided Continue → run the intermediate RTM step
  onInstruction, // instruction button → run the final RTM step
  onCancel, // working Cancel / Esc → abandon the flow
}) {
  const isJupiter = theme === 'jupiter'
  const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'
  const [inputMode, setInputMode] = useState('mouse')
  const isAsk = stage === 'ask'
  const isWorking = stage === 'working'
  const isGuided = stage === 'guided'
  const isInstruction = stage === 'instruction'
  const buttonCount = isAsk ? 2 : 1

  const handleHover = () => playSound(hoverSound)
  const handleSelect = (callback) => {
    playSound(selectSound)
    callback?.()
  }

  const handlePrimary = () => {
    if (isAsk) handleSelect(onYes)
    else if (isWorking) handleSelect(onCancel)
    else if (isGuided) handleSelect(onContinue)
    else handleSelect(onInstruction)
  }

  const handleSecondary = () => handleSelect(onNo)

  const focusedIndex = useControllerNavigation({
    itemCount: buttonCount,
    allowedDirections: ['left', 'right'],
    enabled: Boolean(stage),
    onControllerActivity: () => setInputMode('controller'),
    onMove: () => {
      setInputMode('controller')
      handleHover()
    },
    onConfirm: (index) => {
      if (index === 0) handlePrimary()
      else handleSecondary()
    },
    // Esc / controller-B always abandons the flow — no side effects.
    onBack: onCancel,
  })

  if (!stage) return null

  const title = isAsk
    ? 'ARE YOU IN A WARZONE LOBBY?'
    : isWorking
      ? (copy?.workingTitle || 'WORKING')
      : isGuided
        ? 'SET UP YOUR LOCAL GAME'
        : (copy?.instructionTitle || 'YOUR LOADOUTS')

  return createPortal(
    <div className="modal-overlay" role="presentation">
      <div
        className={`jupiter-host-prompt-modal ${isJupiter ? '' : 'iw8-styled'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modding-flow-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="jupiter-join-accent-bar" />
        <div className="jupiter-join-content">
          {!isAsk && (
            <span className="jupiter-join-kicker">
              {isWorking ? 'PREPARING GAME' : isGuided ? 'PHA CLIENT STEPS' : 'LOADOUT SETUP'}
            </span>
          )}
          <h2 id="modding-flow-title">{title}</h2>

          {isAsk ? (
            <p className="jupiter-join-intro">
              {copy?.askIntro || 'Are you already in a Warzone lobby? Yes skips the launcher prep; No drives the PHA Client menus into Warzone mode first.'}
            </p>
          ) : isWorking ? (
            <div className="jupiter-host-prompt-prepping">
              <div className="jupiter-host-prompt-spinner" aria-hidden="true" />
              <p className="jupiter-join-intro">
                {copy?.workingIntro || 'The launcher is driving the local game menus. Keep the game visible — this takes a few seconds.'}
              </p>
            </div>
          ) : isGuided ? (
            <>
              <p className="jupiter-join-intro">
                The launcher has prepared Jupiter. Create the local game in the PHA Client, then return here.
              </p>
              <ol className="jupiter-join-steps">
                {guidedSteps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </>
          ) : (
            <p className="jupiter-join-intro">{copy?.instructionBody}</p>
          )}

          <div className="jupiter-join-actions">
            {isAsk ? (
              <>
                <button
                  type="button"
                  className={`jupiter-join-button ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
                  onMouseEnter={handleHover}
                  onClick={handlePrimary}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className={`jupiter-join-button secondary ${inputMode === 'controller' && focusedIndex === 1 ? 'controller-focused' : ''}`}
                  onMouseEnter={handleHover}
                  onClick={handleSecondary}
                >
                  No
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`jupiter-join-button ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={handlePrimary}
              >
                {isWorking ? 'Cancel' : isGuided ? 'Continue' : (copy?.instructionButton || 'Finish')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.getElementById('ui-portal-root') || document.body,
  )
}
