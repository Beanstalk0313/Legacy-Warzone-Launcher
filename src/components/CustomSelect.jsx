import React, { useEffect, useRef } from 'react'
import { playSound } from '../utils/audio'

// Controller-friendly dropdown used wherever a native <select> would fight
// the gamepad (Host a Match fields/dashboard, Options dropdowns). Native
// selects respond to up/down by scrolling every option — with the launcher's
// controller hook running at the same time that scrolls THROUGH the whole
// form, and A just keeps flipping options instead of confirming.
//
// Instead, this is a fully controlled picker: the PARENT owns the open state
// so its useControllerNavigation hook can swap the nav target to the option
// list when a dropdown is open (see HostMatch / OptionsTab):
//   isOpen / onToggle / onClose — open state + mouse interactions
//   focusIndex                   — which option wears controller focus
//   onSelect(value)              — pick an option (parent applies + closes)
//
// Mouse: click the trigger to open/close, click an option to pick, click
// anywhere outside to close. Controller: the parent's hook drives the open
// state, up/down moves focusIndex, A confirms via onSelect, B closes.
export default function CustomSelect({
  value,
  options,
  onSelect,
  isOpen = false,
  onToggle,
  onClose,
  focusIndex = null,
  theme = 'jupiter',
  className = '',
  ariaLabel,
}) {
  const isJupiter = theme === 'jupiter'
  const hoverSound = 'jupHover'
  const selectSound = 'jupSelect'
  const rootRef = useRef(null)

  // Mouse: click anywhere outside the dropdown closes it.
  useEffect(() => {
    if (!isOpen) return undefined
    const onMouseDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) onClose?.()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [isOpen, onClose])

  const handlePick = (option) => {
    playSound(selectSound)
    onSelect?.(option)
    // Mouse picks close the list immediately (controller picks close via the
    // parent's option hook) — clicking an option must not leave the dropdown
    // hanging open until an outside click.
    onClose?.()
  }

  return (
    <div
      ref={rootRef}
      className={`custom-select ${isOpen ? 'is-open' : ''} ${className}`}
    >
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => {
          playSound(selectSound)
          onToggle?.()
        }}
        onMouseEnter={() => playSound(hoverSound)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <span className="custom-select-value">{value}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && (
        <div className="custom-select-options" role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              className={`custom-select-option ${option === value ? 'selected' : ''} ${focusIndex === index ? 'controller-focused' : ''}`}
              onClick={() => handlePick(option)}
              onMouseEnter={() => playSound(hoverSound)}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
