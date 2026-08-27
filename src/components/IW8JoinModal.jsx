import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'

// IW8 join modal: displays the `party_joinsession [lan code]` command in a
// code block with a copy button. The user copies the command, pastes it into
// the IW8 game console, then clicks Done to close the modal and enter the
// connected in-server screen. Simple, no RTM automation.
export default function IW8JoinModal({ isOpen, serverName, lanSession, onDone, onCancel }) {
  const hoverSound = 'iw8Hover'
  const selectSound = 'iw8Select'
  const [inputMode, setInputMode] = useState('mouse')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setInputMode('mouse')
    setCopied(false)
  }, [isOpen, lanSession])

  const handleHover = () => playSound(hoverSound)
  const handleSelect = (callback) => {
    playSound(selectSound)
    callback?.()
  }

  const handleCopy = async () => {
    if (!lanSession) return
    const command = `party_joinsession ${lanSession}`
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Fallback: select the text so the user can Ctrl+C
    }
  }

  const focusedIndex = useControllerNavigation({
    itemCount: 2, // Copy + Done
    allowedDirections: ['left', 'right'],
    enabled: Boolean(isOpen),
    onControllerActivity: () => setInputMode('controller'),
    onMove: () => {
      setInputMode('controller')
      handleHover()
    },
    onConfirm: (index) => {
      if (index === 0) handleSelect(handleCopy)
      else handleSelect(onDone)
    },
    onBack: onCancel,
  })

  if (!isOpen) return null

  const command = lanSession ? `party_joinsession ${lanSession}` : ''

  return createPortal(
    <div className="modal-overlay" role="presentation">
      <div
        className="iw8-join-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="iw8-join-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="iw8-join-content">
          <h2 id="iw8-join-title">Join {serverName}</h2>
          <p className="iw8-join-intro">
            Copy the command below and paste it into your game console to join this server.
          </p>

          {command && (
            <div className="iw8-join-code-block">
              <code className="iw8-join-code">{command}</code>
              <button
                type="button"
                className={`iw8-join-copy-btn ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={() => handleSelect(handleCopy)}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}

          {!lanSession && (
            <p className="iw8-join-no-session">
              No LAN session available for this server.
            </p>
          )}

          <div className="iw8-join-actions">
            <button
              type="button"
              className={`iw8-join-done-btn ${inputMode === 'controller' && focusedIndex === 1 ? 'controller-focused' : ''}`}
              onMouseEnter={handleHover}
              onClick={() => handleSelect(onDone)}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.getElementById('ui-portal-root') || document.body,
  )
}
