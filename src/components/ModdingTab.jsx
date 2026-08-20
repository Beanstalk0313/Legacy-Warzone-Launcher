import React, { useEffect, useMemo, useRef, useState } from 'react'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { focusTextInput } from '../utils/keyboard'
import {
  isTauriRuntime,
  runJupiterPrepSequence,
  runRtm,
  writeJupiterLuaCommand,
} from '../utils/jupiterRtm'
import { useSettings } from './SettingsProvider'
import JupiterErrorModal from './JupiterErrorModal'
import ModdingFlowModal from './ModdingFlowModal'

/**
 * PHA Client tab (Jupiter only — RTM.exe drives the Warzone III game).
 *
 * Each entry in MODDING_TOOLS is one action: a button plus a short
 * description of what it does. More tools will land here as the tab grows.
 *
 * "Save Data" / "Load Data" run the bundled RTM.exe with `-savedata` /
 * `-loaddata` — snapshotting / restoring the player's classes, operator,
 * settings, and loadouts.
 *
 * "Switch to Warzone Mode" drives the PHA Client back into Warzone mode
 * through the bundled RTM.exe: -lua "MainMenuOffline" → 2 s →
 * -lua "WarzonePrivateMatchLobby" → 2 s → -lua "MainMenuOffline" (the same
 * runJupiterPrepSequence() the join/host flows use).
 *
 * "Change Username" runs the bundled RTM.exe with `-rename "<name>"` — the
 * newer tool's native way to rename the player (e.g. "CoDKING").
 *
 * "Switch to Zombies" runs the bundled RTM.exe with `-setzombies` — the newer
 * tool's native flag that switches the game into Zombies mode.
 *
 * The two `kind: 'flow'` tools are multi-step guided flows (ModdingFlowModal):
 *
 *   "Loadout and Operator Editing" — asks if you're in a Warzone lobby
 *   (Yes skips the prep), runs the prep unless skipped, shows the Local
 *   Play → Create Game steps, re-runs `-lua WarzonePrivateMatchLobby` on
 *   Continue, then lets you edit classes/operators and Finish →
 *   `-lua MainMenuOffline`.
 *
 *   "Loadout Display Bug Fix" — same ask + prep + Local Play steps, then on
 *   Continue runs `-brmodejup`, tells you to create 10 loadouts once, and on
 *   the final Continue runs `-disablebrjup` then `-savedata`.
 */
const MODDING_TOOLS = [
  {
    label: 'Save Data',
    description: 'Saves your classes, operator, settings, and loadouts (RTM.exe -savedata).',
    run: () => runRtm(['-savedata']),
  },
  {
    label: 'Load Data',
    description: 'Loads your saved classes, operator, and settings (RTM.exe -loaddata).',
    run: () => runRtm(['-loaddata']),
  },
  {
    label: 'Switch to Warzone Mode',
    description: 'Switches PHA Client to Warzone mode.',
    run: (signal) => runJupiterPrepSequence(1500, signal),
  },
  {
    label: 'Switch to Zombies',
    description: 'Switches the game to Zombies mode.',
    note: "Make sure you're in the Local Game server browser menu to avoid possible issues.",
    run: () => runRtm(['-setzombies']),
  },
  {
    label: 'Loadout and Operator Editing',
    description: 'Prepares a local game so you can edit your classes and operators, then returns you to the main menu.',
    kind: 'flow',
    flowKey: 'loadout-edit',
    copy: {
      askIntro: 'Are you already in a Warzone lobby? Choose Yes to skip the prep — choose No to have the launcher drive the PHA Client menus into Warzone mode first.',
      workingTitle: 'PREPARING THE GAME',
      workingIntro: 'The launcher is driving the local game menus. Keep the game visible — this takes a few seconds.',
      instructionTitle: 'EDIT YOUR LOADOUTS',
      instructionBody: "You can now edit your classes and operators. When you are done, press Finish below — the launcher will return you to the main menu.",
      instructionButton: 'Finish',
    },
  },
  {
    label: 'Loadout Display Bug Fix',
    description: 'Fixes the loadout display bug: enables BR mode, has you create 10 blank loadouts once, then disables it and saves your data.',
    kind: 'flow',
    flowKey: 'bugfix',
    copy: {
      askIntro: 'Are you already in a Warzone lobby? Choose Yes to skip the prep — choose No to have the launcher drive the PHA Client menus into Warzone mode first.',
      workingTitle: 'PREPARING THE GAME',
      workingIntro: 'The launcher is driving the local game menus. Keep the game visible — this takes a few seconds.',
      instructionTitle: 'CREATE YOUR 10 BLANK LOADOUTS',
      instructionBody: "Go to the Weapons menu and create your 10 blank loadouts now — you only have to do this once. They don't actually define your classes: this just unlocks all 10 custom slots so the bug where only custom loadout 1 is selectable goes away. When you're done, come back to the launcher and press Continue: the launcher will disable BR mode and save your data.",
      instructionButton: 'Continue',
    },
  },
]

// ── Developer Mode: the raw RTM tool surface (mirrors RTM.exe -h) ────────
// Flag-only commands → one button each.
const DEV_BUTTON_COMMANDS = [
  { flag: '-savedata', description: 'Save savedata.' },
  { flag: '-loaddata', description: 'Load savedata.' },
  { flag: '-disconnect', description: 'Disconnect / leave in-game.' },
  { flag: '-startmatch', description: 'Start match (xpartygo).' },
  { flag: '-createlobby', description: 'Create/force a lobby (xstartlobby).' },
  { flag: '-setzombies', description: 'Switch to zombies mode (JUP).' },
  { flag: '-showinfo', description: 'Show your info (prints asset paths to console).' },
  { flag: '-hotreloadgsc', description: 'Hot reload MP GSC.' },
  { flag: '-hotreloadzmgsc', description: 'Hot reload ZM GSC.' },
  { flag: '-restoregsc', description: 'Restore GSC.' },
  { flag: '-dumpweapondef', description: 'Dump weapondef (MW19).' },
  { flag: '-loadweapondef', description: 'Load weapondef (MW19).' },
  { flag: '-loadcustomcamo', description: 'Load custom camo.' },
  { flag: '-brmode', description: 'Enable BR mode (MW19).' },
  { flag: '-brmodejup', description: 'Enable BR mode (JUP).' },
  { flag: '-disablebrjup', description: 'Disable BR mode (JUP).' },
]

// Commands that take an argument → text field + button.
const DEV_TEXT_COMMANDS = [
  { flag: '-join', placeholder: 'LAN code', maxLength: 64, description: 'Join a LAN session.' },
  { flag: '-cbuf', placeholder: 'command', maxLength: 4096, description: 'Run a cbuf command.' },
  { flag: '-lua', placeholder: 'menu/function', maxLength: 128, description: 'Open a LUA menu / call a LUA function (e.g. MainMenuOffline).' },
  { flag: '-sendips', placeholder: 'ip', maxLength: 128, description: 'Send IPs to friends.' },
  { flag: '-rename', placeholder: 'name', maxLength: 64, description: 'Change username.' },
  { flag: '-level', placeholder: 'level (1-based)', maxLength: 10, description: 'Set level (1-based; writes level-1).' },
  { flag: '-xp', placeholder: 'xp', maxLength: 10, description: 'Set XP.' },
  { flag: '-file', placeholder: 'filename [content]', maxLength: 4096, description: 'Write any RTM command file directly.' },
]

// Debug/log toggles from `RTM.exe -toggles` — checkbox runs
// `-toggle <feature> on|off`.
const DEV_TOGGLE_FEATURES = [
  'botfix', 'customtext', 'debughookmain', 'debughooksub', 'debuglog', 'devlog',
  'dismemberment', 'dlogerror', 'dlogstring', 'exec_everyframe_log',
  'fastfile_gfxworld_detailparam_log', 'fastfile_gfxwrapper_loadparam_log',
  'fastfiledetaillog', 'fastfilegenlog', 'fastfilegfximagedump',
  'fastfilegraphicsassetloadparamlog', 'fastfilehavokdump',
  'fastfilemainassetloadparamlog', 'fastfilematerialdump', 'fastfileshaderdump',
  'fastfilesubassetloadparamlog', 'fastfiletechsetdump', 'fastfileunilog',
  'fastfilexmodelloadparamlog', 'fastfilexmodelsurfloadparamlog', 'fastsavedebuglog',
  'getzonename', 'gscdump', 'gscinject', 'gscloaddebuglog', 'havok_log',
  'lancreate', 'lanfix', 'luadump', 'lualoaddebuglog', 'luaprintdebuglog',
  'regbooldebuglog', 'stringdebug', 'vis_all_umbra', 'vis_bsp_umbra',
  'vis_primlight_umbra', 'vis_refprobe_umbra', 'vis_smodel_umbra',
]

export default function ModdingTab({ theme = 'jupiter', onModalChange }) {
  const isJupiter = theme === 'jupiter'
  const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'
  const { settings } = useSettings()
  const devMode = Boolean(settings?.developer_mode)
  // Status line is hidden while empty — no default "Ready." text.
  const [status, setStatus] = useState('')
  // Index of the tool currently running (null when idle) so each row's
  // label/Cancel state stays correct as more tools are added.
  const [runningIndex, setRunningIndex] = useState(null)
  const [username, setUsername] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [errorModal, setErrorModal] = useState(null)
  // ── Guided flow state (Loadout and Operator Editing / Bug fix) ─────────
  // null when idle; { tool, stage } while a flow is active. The
  // ModdingFlowModal renders the stage and gates the interface's controller
  // nav via onModalChange while open.
  const [flow, setFlow] = useState(null)
  const flowActive = Boolean(flow)
  const flowAbortRef = useRef(null)
  // ── Developer Mode (raw RTM tool) state ────────────────────────────────
  const [devValues, setDevValues] = useState({}) // flag → text field value
  const [devToggles, setDevToggles] = useState({}) // feature → on/off
  const [devBusy, setDevBusy] = useState(false)
  const [inputMode, setInputMode] = useState('mouse')
  const abortRef = useRef(null)

  // Abort an in-flight sequence if the user leaves the tab — RTM.exe must
  // stop being driven and no setState may fire on an unmounted panel. Also
  // reset the modal gate so the interface's controller nav never stays
  // disabled after this panel unmounts.
  useEffect(() => () => {
    abortRef.current?.abort()
    flowAbortRef.current?.abort()
    onModalChange?.(false)
  }, [onModalChange])

  // The interface's own controller nav stays enabled on non-Play tabs, so
  // while the error modal is open (it has its own keyboard handling) the
  // parent must quiet its hook — otherwise Esc would stack the quit modal
  // over the error dialog. Mirrors the `!session?.join` gating for the
  // JupiterSessionProvider modals. Called synchronously so there is never a
  // frame where both hooks are live.
  const closeErrorModal = () => {
    onModalChange?.(false)
    setErrorModal(null)
  }

  const handleHover = () => playSound(hoverSound)

  const handleRun = async (tool, index) => {
    if (runningIndex !== null || devBusy || flowActive) return
    // Guided multi-step flows (Loadout editing / Bug fix) hand off to the
    // flow state machine instead of running a single command.
    if (tool.kind === 'flow') {
      playSound(selectSound)
      if (!isTauriRuntime()) {
        setStatus('RTM.exe is only available in the desktop app — run this from the launcher, not the browser.')
        return
      }
      setFlow({ tool, stage: 'ask' })
      onModalChange?.(true)
      return
    }
    playSound(selectSound)
    if (!isTauriRuntime()) {
      setStatus('RTM.exe is only available in the desktop app — run this from the launcher, not the browser.')
      return
    }
    setRunningIndex(index)
    setStatus(`${tool.label}…`)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await tool.run(controller.signal)
      if (controller.signal.aborted) return
      setStatus(`${tool.label} done.`)
    } catch (error) {
      if (controller.signal.aborted) return
      setErrorModal({
        title: `COULDN'T RUN ${tool.label.toUpperCase()}`,
        message: error?.message || String(error) || 'RTM.exe failed.',
      })
      onModalChange?.(true)
      setStatus(`${tool.label} failed — see the error dialog for details.`)
    } finally {
      abortRef.current = null
      setRunningIndex(null)
    }
  }

  const handleCancel = () => {
    playSound(selectSound)
    abortRef.current?.abort()
    setRunningIndex(null)
    setStatus('Cancelled.')
  }

  // Run the raw RTM tool's -rename with the typed username.
  const handleRename = async () => {
    const newName = username.trim()
    if (!newName || renaming || runningIndex !== null || devBusy || flowActive) return
    playSound(selectSound)
    if (!isTauriRuntime()) {
      setStatus('RTM.exe is only available in the desktop app — run this from the launcher, not the browser.')
      return
    }
    setRenaming(true)
    setStatus('Renaming…')
    try {
      await runRtm(['-rename', newName])
      setStatus(`Username saved — the game will rename you to ${newName}.`)
    } catch (error) {
      setErrorModal({
        title: "COULDN'T CHANGE USERNAME",
        message: error?.message || String(error) || 'Failed to write the rename file.',
      })
      onModalChange?.(true)
      setStatus('Username change failed — see the error dialog for details.')
    } finally {
      setRenaming(false)
    }
  }

  const handleUsernameEnter = (event) => {
    if (event.key === 'Enter') void handleRename()
  }

  // ── Controller navigation ────────────────────────────────────────────────
  // One flat list covering the tool buttons, the username row, and (in
  // Developer Mode) every raw-RTM command button / text row / toggle. Text
  // rows hand off to the on-screen keyboard; Enter inside the input runs the
  // command. The flow + error modals gate the interface via onModalChange —
  // this hook goes quiet while either is open.
  const navItems = useMemo(() => {
    const items = MODDING_TOOLS.map((tool, index) => ({ kind: 'tool', tool, index }))
    items.push({ kind: 'username' })
    if (devMode) {
      for (const cmd of DEV_BUTTON_COMMANDS) items.push({ kind: 'devFlag', cmd })
      for (const cmd of DEV_TEXT_COMMANDS) items.push({ kind: 'devText', cmd })
      for (const feature of DEV_TOGGLE_FEATURES) items.push({ kind: 'devToggle', feature })
    }
    return items
  }, [devMode])

  const focusedIndex = useControllerNavigation({
    itemCount: navItems.length,
    allowedDirections: ['up', 'down'],
    onControllerActivity: () => setInputMode('controller'),
    onMove: (index) => {
      setInputMode('controller')
      playSound(hoverSound)
    },
    onConfirm: (index, source) => {
      setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
      const item = navItems[index]
      if (!item) return
      if (item.kind === 'tool') void handleRun(item.tool, item.index)
      else if (item.kind === 'username') focusTextInput('.modding-username-input', setInputMode)
      else if (item.kind === 'devFlag') void runDevFlag(item.cmd)
      else if (item.kind === 'devText') focusTextInput(`[data-modding-dev-input="${item.cmd.flag}"]`, setInputMode)
      else if (item.kind === 'devToggle') void handleDevToggle(item.feature)
    },
    enabled: !errorModal && !flowActive,
  })

  const isNavFocused = (predicate) => {
    if (inputMode !== 'controller') return false
    const item = navItems[focusedIndex]
    return Boolean(item && predicate(item))
  }

  // ── Guided flow handlers (Loadout and Operator Editing / Bug fix) ──────
  // Both flows share the same stages: ask ("Are you in a Warzone lobby?")
  // → [prep unless already in a lobby] → guided (Local Play → Create Game)
  // → intermediate RTM step → instruction → final RTM step. Only the
  // intermediate/final commands differ per flowKey.
  const resetFlow = (statusMessage) => {
    flowAbortRef.current?.abort()
    flowAbortRef.current = null
    setFlow(null)
    onModalChange?.(false)
    if (statusMessage) setStatus(statusMessage)
  }

  const failFlow = (title, error) => {
    resetFlow('')
    setErrorModal({
      title,
      message: error?.message || String(error) || 'RTM.exe failed.',
    })
    onModalChange?.(true)
    setStatus(`${title} failed — see the error dialog for details.`)
  }

  // Ask: Yes = already in a Warzone lobby → skip the prep AND the Local
  // Play → Create Game steps (the game is already set up), jumping straight
  // to the flow's next RTM step (what Continue would have run); No → run
  // the prep sequence, then show the guided Local Play steps.
  const handleFlowAsk = async (skipPrep) => {
    if (!flow) return
    if (skipPrep) {
      await handleFlowContinue()
      return
    }
    setFlow((current) => current ? { ...current, stage: 'working' } : current)
    setStatus('Preparing the game…')
    const controller = new AbortController()
    flowAbortRef.current = controller
    try {
      await runJupiterPrepSequence(1500, controller.signal)
      if (controller.signal.aborted) return
      setStatus('Prepared — follow the steps in the dialog.')
      setFlow((current) => current ? { ...current, stage: 'guided' } : current)
    } catch (error) {
      if (controller.signal.aborted) return
      failFlow("COULDN'T PREPARE THE GAME", error)
    } finally {
      flowAbortRef.current = null
    }
  }

  // Guided Continue → the flow's intermediate RTM step.
  const handleFlowContinue = async () => {
    const tool = flow?.tool
    if (!tool) return
    setFlow((current) => current ? { ...current, stage: 'working' } : current)
    setStatus('Working…')
    try {
      if (tool.flowKey === 'loadout-edit') {
        await writeJupiterLuaCommand('WarzonePrivateMatchLobby')
        setStatus('In the local game — edit your classes and operators.')
      } else {
        await runRtm(['-brmodejup'])
        setStatus('BR mode enabled — create your 10 blank loadouts in the Weapons menu.')
      }
      setFlow((current) => current ? { ...current, stage: 'instruction' } : current)
    } catch (error) {
      failFlow("COULDN'T RUN THE NEXT STEP", error)
    }
  }

  // Instruction Finish/Continue → the flow's final RTM step, then close.
  const handleFlowInstruction = async () => {
    const tool = flow?.tool
    if (!tool) return
    setFlow((current) => current ? { ...current, stage: 'working' } : current)
    setStatus('Finishing up…')
    try {
      if (tool.flowKey === 'loadout-edit') {
        await writeJupiterLuaCommand('MainMenuOffline')
        setStatus('Loadout editing done — returned to the main menu.')
      } else {
        await runRtm(['-disablebrjup'])
        await runRtm(['-savedata'])
        setStatus('Bug fix done — BR mode disabled and your loadouts were saved.')
      }
      resetFlow('')
    } catch (error) {
      failFlow("COULDN'T FINISH THE FLOW", error)
    }
  }

  // ── Developer Mode: raw RTM tool handlers ──────────────────────────────
  const runDevFlag = async (cmd) => {
    if (runningIndex !== null || devBusy || flowActive) return
    if (!isTauriRuntime()) {
      setStatus('RTM.exe is only available in the desktop app — run this from the launcher, not the browser.')
      return
    }
    playSound(selectSound)
    setDevBusy(true)
    setStatus(`Running ${cmd.flag}…`)
    try {
      const output = await runRtm([cmd.flag])
      setStatus(output ? `${cmd.flag} → ${output}` : `${cmd.flag} done.`)
    } catch (error) {
      setErrorModal({
        title: `COULDN'T RUN ${cmd.flag}`,
        message: error?.message || String(error) || 'RTM.exe failed.',
      })
      onModalChange?.(true)
      setStatus(`${cmd.flag} failed — see the error dialog for details.`)
    } finally {
      setDevBusy(false)
    }
  }

  const runDevText = async (cmd) => {
    if (runningIndex !== null || devBusy || flowActive) return
    const value = (devValues[cmd.flag] || '').trim()
    if (!value) return
    if ((cmd.flag === '-level' || cmd.flag === '-xp') && !/^\d+$/.test(value)) {
      playSound(selectSound)
      setStatus(`${cmd.flag} expects a positive integer.`)
      return
    }
    if (!isTauriRuntime()) {
      setStatus('RTM.exe is only available in the desktop app — run this from the launcher, not the browser.')
      return
    }
    playSound(selectSound)
    setDevBusy(true)
    setStatus(`Running ${cmd.flag}…`)
    try {
      // -file takes "filename [content]" — split on the first space.
      let args = [cmd.flag]
      if (cmd.flag === '-file') {
        const spaceIndex = value.indexOf(' ')
        const filename = spaceIndex === -1 ? value : value.slice(0, spaceIndex)
        const content = spaceIndex === -1 ? '' : value.slice(spaceIndex + 1).trim()
        args = content ? [cmd.flag, filename, content] : [cmd.flag, filename]
      } else {
        args = [cmd.flag, value]
      }
      const output = await runRtm(args)
      setStatus(output ? `${cmd.flag} → ${output}` : `${cmd.flag} done.`)
    } catch (error) {
      setErrorModal({
        title: `COULDN'T RUN ${cmd.flag}`,
        message: error?.message || String(error) || 'RTM.exe failed.',
      })
      onModalChange?.(true)
      setStatus(`${cmd.flag} failed — see the error dialog for details.`)
    } finally {
      setDevBusy(false)
    }
  }

  const handleDevToggle = async (feature) => {
    if (runningIndex !== null || devBusy || flowActive) return
    if (!isTauriRuntime()) {
      setStatus('RTM.exe is only available in the desktop app — run this from the launcher, not the browser.')
      return
    }
    const next = !devToggles[feature]
    playSound(selectSound)
    setDevToggles((current) => ({ ...current, [feature]: next }))
    setDevBusy(true)
    setStatus(`Toggling ${feature} ${next ? 'on' : 'off'}…`)
    try {
      await runRtm(['-toggle', feature, next ? 'on' : 'off'])
      setStatus(`${feature} is now ${next ? 'on' : 'off'}.`)
    } catch (error) {
      // Roll the checkbox back so the UI reflects what the tool actually did.
      setDevToggles((current) => ({ ...current, [feature]: !next }))
      setErrorModal({
        title: `COULDN'T TOGGLE ${feature}`,
        message: error?.message || String(error) || 'RTM.exe failed.',
      })
      onModalChange?.(true)
      setStatus(`${feature} toggle failed — see the error dialog for details.`)
    } finally {
      setDevBusy(false)
    }
  }

  return (
    <div className={`tab-content-panel ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
      <div className="tab-header-title">
        <h2>PHA CLIENT</h2>
        <span className="tab-subtitle">RTM automation for the Warzone III client</span>
      </div>

      <div className="modding-card">
        <div className="modding-tools">
          {MODDING_TOOLS.map((tool, index) => {
            const isRunning = runningIndex === index
            return (
              <div key={tool.label} className="modding-tool">
                <button
                  type="button"
                  className={`modding-tool-btn ${isNavFocused((item) => item.kind === 'tool' && item.index === index) ? 'controller-focused' : ''}`}
                  onMouseEnter={handleHover}
                  onClick={() => void handleRun(tool, index)}
                  disabled={runningIndex !== null || devBusy || flowActive}
                >
                  {isRunning ? 'Running…' : tool.label}
                </button>
                <span className="modding-tool-desc">{tool.description}</span>
                {tool.note && <span className="modding-tool-note">{tool.note}</span>}
                {isRunning && (
                  <button type="button" className="modding-cancel-btn" onMouseEnter={handleHover} onClick={handleCancel}>
                    Cancel
                  </button>
                )}
              </div>
            )
          })}

          {/* Change Username — runs RTM.exe -rename "<name>". */}
          <div className="modding-tool">
            <button
              type="button"
              className={`modding-tool-btn ${isNavFocused((item) => item.kind === 'username') ? 'controller-focused' : ''}`}
              onMouseEnter={handleHover}
              onClick={() => void handleRename()}
              disabled={renaming || runningIndex !== null || devBusy || flowActive || !username.trim()}
            >
              {renaming ? 'Saving…' : 'Change Username'}
            </button>
            <input
              type="text"
              className={`modding-username-input ${isNavFocused((item) => item.kind === 'username') ? 'controller-focused' : ''}`}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              onKeyDown={handleUsernameEnter}
              onMouseEnter={handleHover}
              placeholder="New username"
              maxLength={64}
              spellCheck={false}
            />
            <span className="modding-tool-desc">Runs RTM.exe -rename — the game will rename you to this.</span>
          </div>
        </div>

        {status && <div className="modding-status">{status}</div>}
      </div>

      {/* ── Developer Mode: the full RTM tool surface (RTM.exe -h) ── */}
      {devMode && (
        <div className="modding-card modding-dev-panel">
          <div className="modding-dev-header">
            <h3>RTM DEV TOOL</h3>
            <span>Raw RTM.exe surface — every flag from the tool's help, no guardrails. Runs each action through the bundled RTM.exe.</span>
          </div>

          <div className="modding-dev-section">
            <h4>COMMANDS</h4>
            <div className="modding-dev-grid">
              {DEV_BUTTON_COMMANDS.map((cmd) => (
                <button
                  key={cmd.flag}
                  type="button"
                  className={`modding-tool-btn modding-dev-btn ${isNavFocused((item) => item.kind === 'devFlag' && item.cmd === cmd) ? 'controller-focused' : ''}`}
                  title={cmd.description}
                  onMouseEnter={handleHover}
                  onClick={() => void runDevFlag(cmd)}
                  disabled={runningIndex !== null || devBusy || flowActive}
                >
                  {cmd.flag}
                </button>
              ))}
            </div>
          </div>

          <div className="modding-dev-section">
            <h4>COMMAND ARGUMENTS</h4>
            <div className="modding-dev-text-list">
              {DEV_TEXT_COMMANDS.map((cmd) => (
                <div key={cmd.flag} className="modding-dev-text-row">
                  <button
                    type="button"
                    className={`modding-tool-btn modding-dev-btn modding-dev-text-btn ${isNavFocused((item) => item.kind === 'devText' && item.cmd === cmd) ? 'controller-focused' : ''}`}
                    onMouseEnter={handleHover}
                    onClick={() => void runDevText(cmd)}
                    disabled={runningIndex !== null || devBusy || flowActive || !(devValues[cmd.flag] || '').trim()}
                  >
                    {cmd.flag}
                  </button>
                  <input
                    type="text"
                    className={`modding-username-input modding-dev-input ${isNavFocused((item) => item.kind === 'devText' && item.cmd === cmd) ? 'controller-focused' : ''}`}
                    data-modding-dev-input={cmd.flag}
                    value={devValues[cmd.flag] || ''}
                    onChange={(event) => setDevValues((current) => ({ ...current, [cmd.flag]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void runDevText(cmd)
                    }}
                    onMouseEnter={handleHover}
                    placeholder={cmd.placeholder}
                    maxLength={cmd.maxLength}
                    spellCheck={false}
                  />
                  <span className="modding-tool-desc">{cmd.description}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="modding-dev-section">
            <h4>DEBUG TOGGLES</h4>
            <span className="modding-tool-desc">Each checkbox runs <code>-toggle &lt;feature&gt; on|off</code> through RTM.exe.</span>
            <div className="modding-dev-toggles">
              {DEV_TOGGLE_FEATURES.map((feature) => (
                <label
                  key={feature}
                  className={`modding-dev-toggle ${devToggles[feature] ? 'on' : ''} ${isNavFocused((item) => item.kind === 'devToggle' && item.feature === feature) ? 'controller-focused' : ''}`}
                  onMouseEnter={handleHover}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(devToggles[feature])}
                    onChange={() => void handleDevToggle(feature)}
                    disabled={runningIndex !== null || devBusy || flowActive}
                  />
                  <span>{feature}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <ModdingFlowModal
        theme={theme}
        stage={flow?.stage || null}
        copy={flow?.tool?.copy}
        onYes={() => void handleFlowAsk(true)}
        onNo={() => void handleFlowAsk(false)}
        onContinue={() => void handleFlowContinue()}
        onInstruction={() => void handleFlowInstruction()}
        onCancel={resetFlow}
      />

      <JupiterErrorModal
        theme={theme}
        isOpen={Boolean(errorModal)}
        title={errorModal?.title}
        message={errorModal?.message}
        onClose={closeErrorModal}
      />
    </div>
  )
}
