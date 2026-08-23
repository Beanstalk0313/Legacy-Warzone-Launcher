import { invoke } from '@tauri-apps/api/core'

export const isTauriRuntime = () => Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__)

function validateCommand(command, label = 'RTM command', options = {}) {
  const value = command?.trim()
  if (!value) throw new Error(`${label} is empty.`)
  // cbuf commands legitimately carry multiple statements — the WZ3 config
  // format puts secondary dvars (e.g. Plunder's cash-to-win) on their own
  // LINE (see wz commands.txt). Only `-cbuf` is allowed newlines; every
  // other command stays control-character-free.
  const hasInvalidControl = [...value].some(
    (character) => /\p{Cc}/u.test(character) && !(options.allowNewlines && character === '\n')
  )
  if (value.length > 4096 || hasInvalidControl) {
    throw new Error(`${label} contains invalid characters or is too long.`)
  }
  return value
}

function ensureDesktopRuntime() {
  if (!isTauriRuntime()) {
    throw new Error('RTM trigger commands are available from the desktop app only.')
  }
}

/**
 * Run ONE RTM action. There is no RTM.exe anymore — the Rust side
 * (`rtm_action` command) translates each flag-shaped action into trigger
 * file writes in Documents\retdonetskmod\rtm, which the modloader inside
 * the game polls. Pass `allowNewlines: true` (only the -cbuf path does) so
 * the multi-line WZ3 config format reaches the game.
 */
export async function runRtm(args, options = {}) {
  ensureDesktopRuntime()
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('No RTM action provided.')
  }
  const safeArgs = args.map((argument) => validateCommand(String(argument), undefined, options))
  return invoke('rtm_action', { args: safeArgs })
}

/** Write a Lua menu/function call: trigger file `luacmd` = name. */
export async function writeJupiterLuaCommand(command) {
  return runRtm(['-lua', validateCommand(command, 'Lua command')])
}

/**
 * Run a game cbuf command: trigger file `cbufcmd` = command. cbuf payloads
 * may contain newlines (the WZ3 config format puts secondary dvars on their
 * own line), so the validation for this path allows them.
 */
export async function writeJupiterCbufCommand(command) {
  return runRtm(['-cbuf', validateCommand(command, undefined, { allowNewlines: true })], { allowNewlines: true })
}

/**
 * Connect to a LAN session by writing the three join trigger files (the
 * same sequence the old RTM.exe -join wrote), all in
 * Documents\retdonetskmod\rtm:
 *
 *   req_execcmd.ntc  → empty trigger file
 *   command.txt      → "connect <session>"  (e.g. "connect 123456")
 *   cbufcmd          → same contents as command.txt
 *
 * Written in that order by the Rust side; `.ntc` is the trigger and
 * `command.txt` carries the payload.
 */
export async function joinJupiterLanSession(lanSession) {
  const session = validateCommand(lanSession, 'LAN session code')
  await runRtm(['-join', session])
}

/**
 * The standard game-prep sequence used before joining OR hosting a local game:
 *   -lua "MainMenuOffline" → 1.5s → -lua "WarzonePrivateMatchLobby" → 1.5s → -lua "MainMenuOffline"
 * Each step waits for the previous RTM action to finish, then waits `gapMs`
 * (default 1500) between steps so the game can react to each cue.
 *
 * Pass an AbortSignal to cancel mid-sequence (the in-flight wait is cut short
 * and an AbortError is thrown).
 */
export async function runJupiterPrepSequence(gapMs = 1500, signal) {
  const steps = ['MainMenuOffline', 'WarzonePrivateMatchLobby', 'MainMenuOffline']
  for (let index = 0; index < steps.length; index += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await writeJupiterLuaCommand(steps[index])
    if (index < steps.length - 1) {
      await new Promise((resolve) => {
        const timer = window.setTimeout(resolve, gapMs)
        signal?.addEventListener('abort', () => {
          window.clearTimeout(timer)
          resolve()
        }, { once: true })
      })
    }
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
}

export const wait = (milliseconds) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))