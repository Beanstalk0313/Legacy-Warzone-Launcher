/**
 * Virtual keyboard utilities for controller mode.
 *
 * On game consoles (Xbox, PlayStation, Steam Deck) and mobile devices,
 * the system provides an on-screen keyboard when a text input receives
 * focus. This module ensures that:
 *
 * 1. When a text input is focused via controller navigation, the input
 *    is made ready for typing by focusing it properly.
 * 2. A visual indicator shows that the input is active and ready for
 *    on-screen keyboard input.
 * 3. The input mode switches to 'mouse' so the controller nav doesn't
 *    intercept typing.
 */

/**
 * Focus a text input and switch input mode to 'mouse' so controller
 * navigation doesn't intercept typing. This triggers the system's
 * on-screen keyboard on game consoles and mobile devices.
 *
 * @param {string} selector - CSS selector for the input element
 * @param {function} setInputMode - Function to set input mode to 'mouse'
 */
export function focusTextInput(selector, setInputMode) {
  const element = document.querySelector(selector)
  if (!element) return

  // Switch to mouse mode so controller nav doesn't intercept typing
  if (setInputMode) {
    setInputMode('mouse')
  }

  // Focus the input to trigger on-screen keyboard
  element.focus()

  // Add a brief visual pulse to indicate the input is ready
  element.classList.add('input-active-pulse')
  setTimeout(() => {
    element.classList.remove('input-active-pulse')
  }, 300)
}

/**
 * Create a keyboard hint that shows when a text input is focused on controller.
 * This helps users understand they can now use the on-screen keyboard.
 *
 * @param {boolean} isController - Whether controller mode is active
 * @param {boolean} isInputFocused - Whether a text input is currently focused
 * @returns {JSX.Element|null} Keyboard hint element
 */
export function ControllerKeyboardHint({ isController, isInputFocused }) {
  if (!isController || !isInputFocused) return null

  return (
    <div className="controller-keyboard-hint">
      <span className="controller-keyboard-hint-icon">⌨</span>
      <span>Use on-screen keyboard to type</span>
    </div>
  )
}
