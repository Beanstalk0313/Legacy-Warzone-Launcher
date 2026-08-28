import React, { useEffect, useState } from 'react'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { useTranslation } from '../utils/i18n'

function stepsForMode(mode) {
  // Zombies and multiplayer sessions are configured natively by the game's
  // own lobby — the guided modal only asks the user to click Local Play
  // (NOT create the game yet); Continue does the mode switch (zombies) +
  // LAN join. Warzone keeps the full walk-through into Create Local Game.
  if (mode === 'zombies') return ['joinsimple.step1']
  if (mode === 'multiplayer') return ['joinsimple.step1']
  return ['join.step1', 'join.step2', 'join.step3']
}

function introForMode(mode, t) {
  if (mode === 'zombies') return t('joinsimple.intro.zombies')
  if (mode === 'multiplayer') return t('joinsimple.intro.mp')
  return t('join.intro')
}

export default function JupiterJoinModal({
  theme = 'jupiter',
  stage,
  serverName,
  mode = 'warzone',
  onContinue,
  onFinish,
  onRetry,
  onCancel,
}) {

  // `theme` is the shell style for accent colors + sounds.
  const { t } = useTranslation()
  const isJupiter = theme === 'jupiter'
  const hoverSound = 'jupHover'
  const selectSound = 'jupSelect'
  const [inputMode, setInputMode] = useState('mouse')
  const isGuided = stage === 'guided'
  const isSending = stage === 'sending'
  const isResult = stage === 'result'
  const isPreparing = stage === 'preparing'
  const buttonCount = isGuided || isSending || isPreparing ? 1 : 2

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
    onBack: () => {
      if (isPreparing || isGuided) {
        playSound(selectSound)
        onCancel?.()
      }
    },
  })

  if (!stage) return null

  const title = isGuided
    ? t('join.title.join', { server: serverName })
    : stage === 'preparing'
      ? t('join.title.preparing')
      : isSending
        ? t('join.title.sending')
        : t('join.title.result')

  const guidedSteps = stepsForMode(mode)

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className={`jupiter-join-modal `}
        role="dialog"
        aria-modal="true"
        aria-labelledby="jupiter-join-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="jupiter-join-accent-bar" />
        <div className="jupiter-join-content">
          <h2 id="jupiter-join-title">{title}</h2>

          {isGuided && (
            <>
              <p className="jupiter-join-intro">{introForMode(mode, t)}</p>
              <ol className="jupiter-join-steps">
                {guidedSteps.map((key) => <li key={key}>{t(key)}</li>)}
              </ol>
            </>
          )}

          {isPreparing && (
            <p className="jupiter-join-intro">{t('join.preparing')}</p>
          )}

          {isSending && (
            <p className="jupiter-join-intro">{t('join.sending')}</p>
          )}

          {isResult && (
            <p className="jupiter-join-intro">{t('join.result')}</p>
          )}

          <div className="jupiter-join-actions">
            {isResult && (
              <button
                type="button"
                className={`jupiter-join-button ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={() => handleSelect(onFinish)}
              >
                {t('join.finish')}
              </button>
            )}
            {isResult && (
              <button
                type="button"
                className={`jupiter-join-button secondary ${inputMode === 'controller' && focusedIndex === 1 ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={handleSecondary}
              >
                {t('join.retry')}
              </button>
            )}
            {isGuided && (
              <button
                type="button"
                className={`jupiter-join-button ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={handlePrimary}
              >
                {t('join.continue')}
              </button>
            )}
            {isPreparing && (
              <>
                <span className="jupiter-join-preparing"><span className="spinner" /> {t('join.preparingBtn')}</span>
                <button
                  type="button"
                  className={`jupiter-join-button secondary ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
                  onMouseEnter={handleHover}
                  onClick={() => handleSelect(onCancel)}
                >
                  {t('join.cancel')}
                </button>
              </>
            )}
            {isSending && <span className="jupiter-join-sending">{t('join.working')}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
