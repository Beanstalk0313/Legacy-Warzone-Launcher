import { useEffect, useRef, useState } from 'react'

const INITIAL_REPEAT_DELAY = 280
const REPEAT_INTERVAL = 115
const STICK_DEADZONE = 0.2

const directionForKey = (key) => {
  if (key === 'ArrowLeft' || key === 'ArrowUp') return key === 'ArrowLeft' ? 'left' : 'up'
  if (key === 'ArrowRight' || key === 'ArrowDown') return key === 'ArrowRight' ? 'right' : 'down'
  return null
}

const directionForGamepad = (gamepad, allowedDirections) => {
  const buttons = gamepad.buttons || []
  const digitalDirections = [
    ['up', 12],
    ['down', 13],
    ['left', 14],
    ['right', 15],
  ]

  for (const [direction, buttonIndex] of digitalDirections) {
    if (allowedDirections.includes(direction) && buttons[buttonIndex]?.pressed) return direction
  }

  const rawX = gamepad.axes?.[0] || 0
  const rawY = gamepad.axes?.[1] || 0
  const x = allowedDirections.includes('left') || allowedDirections.includes('right') ? rawX : 0
  const y = allowedDirections.includes('up') || allowedDirections.includes('down') ? rawY : 0
  const dominantMagnitude = Math.max(Math.abs(x), Math.abs(y))

  if (dominantMagnitude < STICK_DEADZONE) return null
  if (Math.abs(x) >= Math.abs(y)) return x < 0 ? 'left' : 'right'
  return y < 0 ? 'up' : 'down'
}

export function useControllerNavigation({
  itemCount,
  onConfirm,
  onBack,
  onMove,
  onBumper,
  onTrigger,
  onControllerActivity,
  onNavigate,
  allowedDirections = ['up', 'down', 'left', 'right'],
  repeat = true,
  initialIndex = 0,
  enabled = true,
  // Bumper-only mode: the hook responds ONLY to the tab-switch bumpers
  // (Q/E keys + LB/RB on the gamepad). Arrows, stick movement, confirm (A /
  // Enter) and back (B / Esc) are ignored — they belong to a child screen's
  // own hook. Used by the parent interface while a Play subview (Server
  // Browser / Host a Match) owns the real navigation, so the user can still
  // hop between tabs with the bumpers without double-firing on the child.
  bumpersOnly = false,
}) {
  const [focusedIndex, setFocusedIndex] = useState(initialIndex)
  const focusedIndexRef = useRef(initialIndex)
  const itemCountRef = useRef(itemCount)
  const allowedDirectionsRef = useRef(allowedDirections)
  const onConfirmRef = useRef(onConfirm)
  const onBackRef = useRef(onBack)
  const onMoveRef = useRef(onMove)
  const onBumperRef = useRef(onBumper)
  const onTriggerRef = useRef(onTrigger)
  const onControllerActivityRef = useRef(onControllerActivity)
  const onNavigateRef = useRef(onNavigate)

  itemCountRef.current = itemCount
  allowedDirectionsRef.current = allowedDirections
  onConfirmRef.current = onConfirm
  onBackRef.current = onBack
  onMoveRef.current = onMove
  onBumperRef.current = onBumper
  onTriggerRef.current = onTrigger
  onControllerActivityRef.current = onControllerActivity
  onNavigateRef.current = onNavigate

  useEffect(() => {
    const nextIndex = Math.min(initialIndex, Math.max(0, itemCount - 1))
    focusedIndexRef.current = nextIndex
    setFocusedIndex(nextIndex)
  }, [itemCount, initialIndex])

  const allowedDirectionsKey = allowedDirections.join('|')

  useEffect(() => {
    if (!enabled) return undefined

    const heldKeys = new Set()
    const previousButtons = []
    let previousDirection = null
    let nextRepeatAt = 0
    let hasSampledGamepad = false

    const moveFocus = (direction, source) => {
      const directions = allowedDirectionsRef.current
      if (!direction || !directions.includes(direction)) return

      const count = itemCountRef.current
      if (count < 1) return

      const currentIndex = focusedIndexRef.current
      const navigate = onNavigateRef.current
      const nextIndex = navigate
        ? navigate(direction, currentIndex, count, source)
        : (direction === 'up' || direction === 'left' ? currentIndex - 1 : currentIndex + 1)

      if (typeof nextIndex !== 'number' || nextIndex === currentIndex) return

      const normalizedIndex = (nextIndex + count) % count
      focusedIndexRef.current = normalizedIndex
      setFocusedIndex(normalizedIndex)
      onMoveRef.current?.(normalizedIndex, direction, source)
    }

    const handleBumper = (direction, source) => {
      const nextIndex = onBumperRef.current?.(direction, focusedIndexRef.current, source)
      if (typeof nextIndex !== 'number') return

      const count = itemCountRef.current
      const normalizedIndex = (nextIndex + count) % count
      focusedIndexRef.current = normalizedIndex
      setFocusedIndex(normalizedIndex)
    }

    const handleKeyDown = (event) => {
      const target = event.target
      if (target instanceof HTMLElement && (
        target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'TEXTAREA'
      )) return

      // Triggers (LT/RT on a gamepad, [ / ] on the keyboard) switch a
      // secondary group — the Options tab uses them for its sub-tabs so
      // the bumpers stay free for top-level tab switching. Only hooks
      // that provide onTrigger respond; held-key deduped like the bumpers
      // so a long press fires once.
      if (onTriggerRef.current && (event.key === '[' || event.key === ']')) {
        event.preventDefault()
        if (!heldKeys.has(event.key)) {
          heldKeys.add(event.key)
          onTriggerRef.current(event.key === '[' ? 'left' : 'right', 'keyboard')
        }
        return
      }

      // Bumper-only mode (see the hook doc above): Q / E tab-switch keys
      // respond; arrows, confirm and back belong to the child screen's hook.
      if (bumpersOnly) {
        const key = event.key.toLowerCase()
        if (key === 'q' || key === 'e') {
          event.preventDefault()
          if (!heldKeys.has(key)) {
            heldKeys.add(key)
            handleBumper(key === 'q' ? 'left' : 'right', 'keyboard')
          }
        }
        return
      }

      const direction = directionForKey(event.key)
      if (direction) {
        event.preventDefault()
        if (!event.repeat) moveFocus(direction, 'keyboard')
        return
      }

      if (event.key.toLowerCase() === 'q') {
        event.preventDefault()
        if (!heldKeys.has(event.key)) {
          heldKeys.add(event.key)
          handleBumper('left', 'keyboard')
        }
        return
      }

      if (event.key.toLowerCase() === 'e') {
        event.preventDefault()
        if (!heldKeys.has(event.key)) {
          heldKeys.add(event.key)
          handleBumper('right', 'keyboard')
        }
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (!heldKeys.has(event.key)) {
          heldKeys.add(event.key)
          onConfirmRef.current?.(focusedIndexRef.current, 'keyboard')
        }
        return
      }

      if (event.key === 'Escape' || event.key.toLowerCase() === 'backspace') {
        event.preventDefault()
        if (!heldKeys.has(event.key)) {
          heldKeys.add(event.key)
          onBackRef.current?.('keyboard')
        }
      }
    }

    const handleKeyUp = (event) => {
      heldKeys.delete(event.key)
    }

    const clearKeyboardState = () => heldKeys.clear()

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', clearKeyboardState)

    let animationFrameId
    const pollGamepad = (time) => {
      const gamepads = navigator.getGamepads?.() || []
      const gamepad = Array.from(gamepads).find(Boolean)

      if (!gamepad) {
        previousButtons.length = 0
        previousDirection = null
        nextRepeatAt = 0
        hasSampledGamepad = false
      } else {
        const buttons = gamepad.buttons.map((button) => Boolean(button.pressed))
        const direction = bumpersOnly ? null : directionForGamepad(gamepad, allowedDirectionsRef.current)

        // Establish a baseline when the hook mounts or changes screens. This
        // prevents the button that opened a modal, or a held stick, from being
        // interpreted as a second input by the newly mounted hook.
        if (!hasSampledGamepad) {
          previousButtons.splice(0, previousButtons.length, ...buttons)
          previousDirection = direction
          nextRepeatAt = 0
          hasSampledGamepad = true
        } else {
          const justPressed = (index) => buttons[index] && !previousButtons[index]

          if (justPressed(4)) {
            onControllerActivityRef.current?.('bumper-left')
            handleBumper('left', 'gamepad')
          }
          if (justPressed(5)) {
            onControllerActivityRef.current?.('bumper-right')
            handleBumper('right', 'gamepad')
          }

          // Triggers (LT/RT, buttons 6/7) — used by the Options tab's
          // sub-tabs so the bumpers stay free for top-level tab switching.
          // Only hooks that provided onTrigger respond; the parent
          // interface hook ignores these buttons.
          if (onTriggerRef.current) {
            if (justPressed(6)) {
              onControllerActivityRef.current?.('trigger-left')
              onTriggerRef.current('left', 'gamepad')
            }
            if (justPressed(7)) {
              onControllerActivityRef.current?.('trigger-right')
              onTriggerRef.current('right', 'gamepad')
            }
          }

          // Bumper-only mode: A / B and stick movement belong to the child
          // screen's own hook — only the bumpers respond here.
          if (!bumpersOnly) {
            if (justPressed(0)) {
              onControllerActivityRef.current?.('confirm')
              onConfirmRef.current?.(focusedIndexRef.current, 'gamepad')
            }
            if (justPressed(1)) {
              onControllerActivityRef.current?.('back')
              onBackRef.current?.('gamepad')
            }

            if (direction !== previousDirection) {
              previousDirection = direction
              nextRepeatAt = direction ? time + INITIAL_REPEAT_DELAY : 0
              if (direction) {
                onControllerActivityRef.current?.(direction)
                moveFocus(direction, 'gamepad')
              }
            } else if (repeat && direction && time >= nextRepeatAt) {
              onControllerActivityRef.current?.(direction)
              moveFocus(direction, 'gamepad')
              nextRepeatAt = time + REPEAT_INTERVAL
            }
          }

          previousButtons.splice(0, previousButtons.length, ...buttons)
        }
      }

      animationFrameId = window.requestAnimationFrame(pollGamepad)
    }

    animationFrameId = window.requestAnimationFrame(pollGamepad)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearKeyboardState)
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [enabled, allowedDirectionsKey, repeat, bumpersOnly])

  return focusedIndex
}
