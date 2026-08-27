import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './jupiterRtm'

// Keyboard input automation for the Jupiter game (the Rust side lives in
// src-tauri/src/game_input.rs). The launcher drives the game's menu with
// SendInput — pure user32 API, no process is ever spawned, so no console
// window can ever flash.

/** Bring the "Call of Duty© HQ" game window to the foreground. Returns
 * whether focus was actually secured (false → the caller falls back to the
 * manual guided steps). */
export async function focusGameWindow() {
  if (!isTauriRuntime()) return false
  try {
    return Boolean(await invoke('focus_game_window'))
  } catch {
    return false
  }
}

/** Tap a single named key in the game window (right, space, x, enter, …). */
export async function sendGameKey(key) {
  if (!isTauriRuntime()) return
  await invoke('send_game_key', { key })
}

// The nav script that drives the game from its offline main menu into the
// Create Local Game screen: three Right presses (0.5 s apart) to reach the
// entry, Space to open it, wait 2 s for the screen to settle, then X to
// confirm. Data-driven so retuning the in-game timing is a one-line change.
export const CREATE_LOCAL_GAME_STEPS = [
  { key: 'right', gapMs: 500 },
  { key: 'right', gapMs: 500 },
  { key: 'right', gapMs: 500 },
  { key: 'space', gapMs: 2000 },
  { key: '5', gapMs: 0 },
]

/** Play a nav script: send each key, then wait `gapMs` before the next one.
 * Honors an AbortSignal (throws AbortError) just like the RTM prep sequence,
 * so a cancel mid-navigation cuts the remaining keys short. */
export async function runGameKeyNav(steps, signal) {
  for (const step of steps) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await sendGameKey(step.key)
    if (step.gapMs > 0) {
      await new Promise((resolve) => {
        const timer = window.setTimeout(resolve, step.gapMs)
        signal?.addEventListener('abort', () => {
          window.clearTimeout(timer)
          resolve()
        }, { once: true })
      })
    }
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}
