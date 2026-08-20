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
    throw new Error('RTM.exe commands are available from the desktop app only.')
  }
}

/**
 * Run the bundled RTM.exe with the given arguments (e.g. ["-lua", "MainMenuOffline"]).
 * RTM.exe writes its trigger files into the game's RTM folder and exits.
 * Pass `allowNewlines: true` (only the -cbuf command path does) so the
 * multi-line WZ3 config format reaches the tool.
 */
export async function runRtm(args, options = {}) {
  ensureDesktopRuntime()
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('No RTM arguments provided.')
  }
  const safeArgs = args.map((argument) => validateCommand(String(argument), undefined, options))
  return invoke('run_rtm', { args: safeArgs })
}

/** Absolute path to the bundled RTM.exe (throws with a friendly message if missing). */
export async function rtmExePath() {
  ensureDesktopRuntime()
  return invoke('rtm_exe_path')
}

/** Write a Lua menu/function call: RTM.exe -lua "<command>". */
export async function writeJupiterLuaCommand(command) {
  return runRtm(['-lua', validateCommand(command, 'Lua command')])
}

/**
 * Run a game cbuf command: RTM.exe -cbuf "<command>". cbuf payloads may
 * contain newlines (the WZ3 config format puts secondary dvars on their own
 * line), so the validation for this path allows them.
 */
export async function writeJupiterCbufCommand(command) {
  return runRtm(['-cbuf', validateCommand(command, undefined, { allowNewlines: true })], { allowNewlines: true })
}

/**
 * Connect to a LAN session via the bundled RTM.exe: RTM.exe -join "<session>".
 *
 * RTM.exe writes the game's trigger files itself and exits:
 *
 *   req_execcmd.ntc  → empty trigger file
 *   command.txt      → "connect <session>"  (e.g. "connect 123456")
 *   cbufcmd          → same contents as command.txt
 *
 * All three land in Documents\retdonetskmod\rtm, the folder the game's file
 * watcher polls, so the game connects to the LAN session.
 */
export async function joinJupiterLanSession(lanSession) {
  const session = validateCommand(lanSession, 'LAN session code')
  await runRtm(['-join', session])
}

/**
 * Write a raw trigger file into the game's RTM folder
 * (Documents\retdonetskmod\RTM). The newer RTM tool exposes the same
 * capability via `-file <filename> [content]`; the Modding tab and the
 * launch-time username sync now use the tool's native flags (-rename /
 * -setzombies) instead of writing trigger files directly.
 *
 * Returns the absolute path of the written file.
 */
export async function writeRtmFile(filename, contents = '') {
  ensureDesktopRuntime()
  const safeFilename = validateCommand(filename, 'RTM file name')
  const trimmedContents = contents.trim()
  const safeContents = trimmedContents
    ? validateCommand(trimmedContents, 'RTM file contents')
    : ''
  return invoke('write_rtm_file', { filename: safeFilename, contents: safeContents })
}

/**
 * The standard game-prep sequence used before joining OR hosting a local game:
 *   -lua "MainMenuOffline" → 1.5s → -lua "WarzonePrivateMatchLobby" → 1.5s → -lua "MainMenuOffline"
 * Each step waits for the previous RTM.exe invocation to finish, then waits
 * `gapMs` (default 1500) between steps so the game can react to each cue.
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
