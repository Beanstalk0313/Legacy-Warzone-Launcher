import { useEffect, useRef, useState } from 'react'

/**
 * Detect the connected controller type by polling the Gamepad API.
 *
 * Returns one of: 'none' | 'xbox' | 'playstation' | 'switch' | 'steam' |
 * 'steamdeck' | 'other'
 *
 * Xbox controllers have IDs containing "xbox" or "x-input".
 * PlayStation controllers have IDs containing "playstation", "ps4", "ps5",
 * "ps3", "dualshock", "dualsense" or "sony".
 * Nintendo controllers have IDs containing "switch", "joy-con" or "nintendo".
 * Valve hardware: "steam deck" → 'steamdeck'; "steam controller" / "valve" →
 * 'steam' (vendor IDs 28de / 28e0 are the fallback).
 *
 * The glyph artwork for each platform lives in src/assets/glyphs/<Platform>/
 * — map the detected type to a glyph platform via glyphs.js.
 */
function parseControllerType(gamepadId) {
  if (!gamepadId) return 'none'
  const lower = gamepadId.toLowerCase()
  // Steam Deck must be checked before the generic Valve/Steam rule — its id
  // contains both "Steam Deck" and "Valve".
  if (lower.includes('steam deck')) return 'steamdeck'
  if (lower.includes('steam controller') || lower.includes('valve')) return 'steam'
  if (
    lower.includes('switch') ||
    lower.includes('joy-con') ||
    lower.includes('joycon') ||
    lower.includes('nintendo')
  ) {
    return 'switch'
  }
  if (lower.includes('xbox') || lower.includes('x-input') || lower.includes('xinput')) {
    return 'xbox'
  }
  if (
    lower.includes('playstation') ||
    lower.includes('ps4') ||
    lower.includes('ps5') ||
    lower.includes('ps3') ||
    lower.includes('dualshock') ||
    lower.includes('dualsense') ||
    lower.includes('sony')
  ) {
    return 'playstation'
  }
  // Valve vendor ids (Steam Controller / Steam Deck) as a last resort — some
  // drivers expose only the vendor/product hex.
  if (lower.includes('28de') || lower.includes('28e0')) return 'steam'
  return 'other'
}

/**
 * React hook that returns the currently connected controller type.
 * Polls at ~1 Hz when a gamepad is detected (faster initial detection).
 *
 * @returns {{ controllerType: 'none' | 'xbox' | 'playstation' | 'switch' | 'steam' | 'steamdeck' | 'other' }}
 */
export function useControllerType() {
  const [controllerType, setControllerType] = useState('none')
  const intervalRef = useRef(null)
  const hasDetectedRef = useRef(false)

  useEffect(() => {
    const poll = () => {
      const gamepads = navigator.getGamepads?.() || []
      const gamepad = Array.from(gamepads).find(Boolean)
      if (gamepad) {
        const type = parseControllerType(gamepad.id)
        setControllerType((prev) => (prev !== type ? type : prev))
        hasDetectedRef.current = true
      } else if (hasDetectedRef.current) {
        // Controller was disconnected
        setControllerType('none')
        hasDetectedRef.current = false
      }
    }

    // Poll at 1 Hz — fast enough for hot-plug detection without
    // being wasteful while idle.
    intervalRef.current = window.setInterval(poll, 1000)
    // Initial poll for already-connected controllers.
    poll()

    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current)
    }
  }, [])

  return { controllerType }
}
