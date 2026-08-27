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
import { useTranslation } from '../utils/i18n'
import JupiterErrorModal from './JupiterErrorModal'
import ModdingFlowModal from './ModdingFlowModal'

/**
 * RTM tab (Jupiter only — RTM trigger files drive the Warzone III game).
 *
 * There is no RTM.exe: every action writes one or more trigger files into
 * Documents\retdonetskmod\rtm, which the modloader inside the game polls.
 *
 * Each entry in MODDING_TOOLS is one action: a button plus a short
 * description of what it does. More tools will land here as the tab grows.
 *
 * "Save Data" / "Load Data" write the `savestatus` / `loadstatus` trigger
 * files — snapshotting / restoring the player's classes, operator,
 * settings, and loadouts.
 *
 * "Switch to Warzone Mode" drives the PHA Client back into Warzone mode
 * via the `luacmd` trigger: MainMenuOffline → 2 s →
 * WarzonePrivateMatchLobby → 2 s → MainMenuOffline (the same
 * runJupiterPrepSequence() the join/host flows use).
 *
 * "Change Username" writes the `rename` trigger file with the new name
 * (e.g. "CoDKING"); the game renames the player to it.
 *
 * "Switch to Zombies" writes the `setzombiesmode` trigger file, switching
 * the game into Zombies mode.
 *
 * "Raise Bot Limit to 23" runs the cbuf `seta #x32D32FD7A0B20A1DD 23`,
 * raising the private-match bot limit so custom games fill out.
 *
 * "Fix Stuck on Connecting… screen" writes the xstartlobby cbuf (same as
 * Create Lobby in the Dev Tool) — creates a fresh lobby to unstick the
 * connecting screen.
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
    label: 'modding.tool.savedata',
    run: () => runRtm(['-savedata']),
  },
  {
    label: 'modding.tool.loaddata',
    run: () => runRtm(['-loaddata']),
  },

  {
    label: 'modding.tool.raisebot',
    run: () => runRtm(['-cbuf', 'seta #x32D32FD7A0B20A1DD 23']),
  },
  {
    label: 'modding.tool.fixconnecting',
    noteKey: 'modding.tool.fixconnecting.note',
    run: () => runRtm(['-createlobby']),
  },
  {
    label: 'modding.tool.loadoutedit',
    kind: 'flow',
    flowKey: 'loadout-edit',
  },
  {
    label: 'modding.tool.loadoutfix',
    kind: 'flow',
    flowKey: 'bugfix',
  },
]

// ── Advanced RTM Mode: the raw RTM tool surface (one action per trigger) ──
// Quick presets — common Lua calls that users run frequently.
const DEV_PRESETS = [
  { label: 'MainMenuOffline', lua: 'MainMenuOffline' },
  { label: 'WarzonePrivateMatchLobby', lua: 'WarzonePrivateMatchLobby' },
]

// Flag-only commands → one button each. Every flag here maps 1:1 to a
// trigger file per the RTM recreation guide.
const DEV_BUTTON_COMMANDS = [
  { flag: '-savedata', description: 'Save savedata (savestatus).' },
  { flag: '-loaddata', description: 'Load savedata (loadstatus).' },
  { flag: '-disconnect', description: 'Disconnect / leave in-game (cbuf disconnect).' },
  { flag: '-startmatch', description: 'Start match (cbuf xpartygo).' },
  { flag: '-createlobby', description: 'Create/force a lobby (cbuf xstartlobby).' },
  { flag: '-setzombies', description: 'Switch to zombies mode (setzombiesmode).' },
  { flag: '-showinfo', description: 'Show your info (showyourinfo — prints asset paths to console).' },
  { flag: '-hotreloadgsc', description: 'Hot reload MP GSC (hotreloadgsc).' },
  { flag: '-hotreloadzmgsc', description: 'Hot reload ZM GSC (hotreloadzmgsc).' },
  { flag: '-restoregsc', description: 'Restore GSC (restoregsc).' },
  { flag: '-loadcustomcamo', description: 'Load custom camo (loadcustomcamo).' },
  { flag: '-brmodejup', description: 'Enable BR mode (JUP).' },
  { flag: '-disablebrjup', description: 'Disable BR mode (JUP).' },
]

// Commands that take an argument → text field + button.
// (-level / -xp / -file had no trigger-file mapping in the RTM recreation
// guide, so they are not exposed — the guide is the source of truth for
// the file format and those were never documented.)
const DEV_TEXT_COMMANDS = [
  { flag: '-join', placeholder: 'LAN code', maxLength: 256, description: 'Join a LAN session (writes the 3 connect trigger files).' },
  { flag: '-cbuf', placeholder: 'command', maxLength: 4096, description: 'Run a cbuf command (writes cbufcmd).' },
  { flag: '-lua', placeholder: 'menu/function', maxLength: 128, description: 'Open a LUA menu / call a LUA function via luacmd (e.g. MainMenuOffline).' },
  { flag: '-sendips', placeholder: 'ip', maxLength: 128, description: 'Send IPs to friends (cbuf sendips <ip>).' },
  { flag: '-rename', placeholder: 'name', maxLength: 64, description: 'Change username (rename file).' },
]

// Debug/log toggles — checkbox runs `-toggle <feature> on|off` (writes the
// `<feature>on` / `<feature>off` state files).
const DEV_TOGGLE_FEATURES = [
  'customtext', 'debughookmain', 'debughooksub', 'debuglog', 'devlog',
  'dismemberment', 'dlogerror', 'dlogstring', 'exec_everyframe_log',
  'fastfile_gfxworld_detailparam_log', 'fastfile_gfxwrapper_loadparam_log',
  'fastfiledetaillog', 'fastfilegenlog', 'fastfilegfximagedump',
  'fastfilegraphicsassetloadparamlog', 'fastfilehavokdump',
  'fastfilemainassetloadparamlog', 'fastfilematerialdump', 'fastfileshaderdump',
  'fastfilesubassetloadparamlog', 'fastfiletechsetdump', 'fastfileunilog',
  'fastfilexmodelloadparamlog', 'fastfilexmodelsurfloadparamlog', 'fastsavedebuglog',
  'getzonename', 'gscdump', 'gscinject', 'gscloaddebuglog', 'havok_log',
  'lancreate', 'luadump', 'lualoaddebuglog', 'luaprintdebuglog',
  'regbooldebuglog', 'stringdebug', 'vis_all_umbra', 'vis_bsp_umbra',
  'vis_primlight_umbra', 'vis_refprobe_umbra', 'vis_smodel_umbra',
]

export default function ModdingTab({ theme = 'jupiter', onModalChange }) {
  const { t } = useTranslation()
  const isJupiter = theme === 'jupiter'
  const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'
  const { settings } = useSettings()
  // Advanced RTM Mode (Options > TESTING & RTM): shows the raw RTM DEV
  // TOOL panel on the right side of this tab. The guided tools above are
  // always available.
  const devMode = Boolean(settings?.rtm_mode)
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
  // ── Advanced RTM Mode (raw RTM tool) state ─────────────────────────────
  const [devValues, setDevValues] = useState({}) // flag → text field value
  const [devToggles, setDevToggles] = useState({}) // feature → on/off
  const [devBusy, setDevBusy] = useState(false)
  const [inputMode, setInputMode] = useState('mouse')
  const abortRef = useRef(null)

  // Abort an in-flight sequence if the user leaves the tab — RTM trigger
  // writes must stop and no setState may fire on an unmounted panel. Also
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
        setStatus(t('modding.desktopOnly'))
        return
      }
      setFlow({ tool, stage: 'ask' })
      onModalChange?.(true)
      return
    }
    playSound(selectSound)
    if (!isTauriRuntime()) {
      setStatus(t('modding.desktopOnly'))
      return
    }
    setRunningIndex(index)
    setStatus(`${t(tool.label)}…`)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await tool.run(controller.signal)
      if (controller.signal.aborted) return
      setStatus(`${t(tool.label)} done.`)
    } catch (error) {
      if (controller.signal.aborted) return
      setErrorModal({
        title: `COULDN'T RUN ${t(tool.label).toUpperCase()}`,
        message: error?.message || String(error) || 'RTM trigger write failed.',
      })
      onModalChange?.(true)
      setStatus(`${t(tool.label)} failed — see the error dialog for details.`)
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
      setStatus(t('modding.desktopOnly'))
      return
    }
    setRenaming(true)
    setStatus(t('modding.tool.saving'))
    try {
      await runRtm(['-rename', newName])
      setStatus(`The game will rename you to ${newName}.`)
    } catch (error) {
      setErrorModal({
        title: "COULDN'T CHANGE USERNAME",
        message: error?.message || String(error) || 'Failed to write the rename trigger file.',
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
  // Advanced RTM Mode) every raw-RTM command button / text row / toggle.
  // Text rows hand off to the on-screen keyboard; Enter inside the input
  // runs the command. The flow + error modals gate the interface via
  // onModalChange — this hook goes quiet while either is open.
  const navItems = useMemo(() => {
    const items = MODDING_TOOLS.map((tool, index) => ({ kind: 'tool', tool, index }))
    items.push({ kind: 'username' })
    if (devMode) {
      for (const preset of DEV_PRESETS) items.push({ kind: 'devPreset', preset })
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
      else if (item.kind === 'devPreset') void runDevPreset(item.preset)
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
      message: error?.message || String(error) || 'RTM trigger write failed.',
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
    setStatus(t('modding.flow.preparing'))
    const controller = new AbortController()
    flowAbortRef.current = controller
    try {
      await runJupiterPrepSequence(1500, controller.signal)
      if (controller.signal.aborted) return
      setStatus(t('modding.flow.prepared'))
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
    setStatus(t('modding.flow.working'))
    try {
      if (tool.flowKey === 'loadout-edit') {
        await writeJupiterLuaCommand('WarzonePrivateMatchLobby')
        setStatus(t('modding.flow.loadoutEditing'))
      } else {
        await runRtm(['-brmodejup'])
        setStatus(t('modding.flow.bugfixStep'))
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
    setStatus(t('modding.flow.finishing'))
    try {
      if (tool.flowKey === 'loadout-edit') {
        await writeJupiterLuaCommand('MainMenuOffline')
        setStatus(t('modding.flow.loadoutDone'))
      } else {
        await runRtm(['-disablebrjup'])
        await runRtm(['-savedata'])
        setStatus(t('modding.flow.bugfixDone'))
      }
      resetFlow('')
    } catch (error) {
      failFlow("COULDN'T FINISH THE FLOW", error)
    }
  }

  // ── Advanced RTM Mode: raw RTM tool handlers ───────────────────────────
  const runDevFlag = async (cmd) => {
    if (runningIndex !== null || devBusy || flowActive) return
    if (!isTauriRuntime()) {
      setStatus(t('modding.desktopOnly'))
      return
    }
    playSound(selectSound)
    setDevBusy(true)
    setStatus(`Running ${cmd.flag}…`)
    try {
      await runRtm([cmd.flag])
      setStatus(`${cmd.flag} done.`)
    } catch (error) {
      setErrorModal({
        title: `COULDN'T RUN ${cmd.flag}`,
        message: error?.message || String(error) || 'RTM trigger write failed.',
      })
      onModalChange?.(true)
      setStatus(`${cmd.flag} failed — see the error dialog for details.`)
    } finally {
      setDevBusy(false)
    }
  }

  const runDevPreset = async (preset) => {
    if (runningIndex !== null || devBusy || flowActive) return
    if (!isTauriRuntime()) {
      setStatus(t('modding.desktopOnly'))
      return
    }
    playSound(selectSound)
    setDevBusy(true)
    setStatus(`Running ${preset.label}…`)
    try {
      await runRtm([`-lua ${preset.lua}`])
      setStatus(`${preset.label} done.`)
    } catch (error) {
      setErrorModal({
        title: `COULDN'T RUN ${preset.label}`,
        message: error?.message || String(error) || 'RTM trigger write failed.',
      })
      onModalChange?.(true)
      setStatus(`${preset.label} failed — see the error dialog for details.`)
    } finally {
      setDevBusy(false)
    }
  }

  const runDevText = async (cmd) => {
    if (runningIndex !== null || devBusy || flowActive) return
    const value = (devValues[cmd.flag] || '').trim()
    if (!value) return
    if (!isTauriRuntime()) {
      setStatus(t('modding.desktopOnly'))
      return
    }
    playSound(selectSound)
    setDevBusy(true)
    setStatus(`Running ${cmd.flag}…`)
    try {
      await runRtm([cmd.flag, value])
      setStatus(`${cmd.flag} done.`)
    } catch (error) {
      setErrorModal({
        title: `COULDN'T RUN ${cmd.flag}`,
        message: error?.message || String(error) || 'RTM trigger write failed.',
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
      setStatus(t('modding.desktopOnly'))
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
        message: error?.message || String(error) || 'RTM trigger write failed.',
      })
      onModalChange?.(true)
      setStatus(`${feature} toggle failed — see the error dialog for details.`)
    } finally {
      setDevBusy(false)
    }
  }

  return (
    <div className={`tab-content-panel modding-tab-panel ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
      <div className="tab-header-title">
        <h2>{t('modding.title')}</h2>
      </div>

      <div className="modding-layout">
      <div className="modding-main">
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
                  {isRunning ? t('modding.tool.running') : t(tool.label)}
                </button>
                {tool.noteKey && <span className="modding-tool-note">{t(tool.noteKey)}</span>}
                {isRunning && (
                  <button type="button" className="modding-cancel-btn" onMouseEnter={handleHover} onClick={handleCancel}>
                    {t('modding.tool.cancel')}
                  </button>
                )}
              </div>
            )
          })}

          {/* Change Username — writes the rename trigger file. */}
          <div className="modding-tool">
            <button
              type="button"
              className={`modding-tool-btn ${isNavFocused((item) => item.kind === 'username') ? 'controller-focused' : ''}`}
              onMouseEnter={handleHover}
              onClick={() => void handleRename()}
              disabled={renaming || runningIndex !== null || devBusy || flowActive || !username.trim()}
            >
              {renaming ? t('modding.tool.saving') : t('modding.tool.changename')}
            </button>
            <input
              type="text"
              className={`modding-username-input ${isNavFocused((item) => item.kind === 'username') ? 'controller-focused' : ''}`}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              onKeyDown={handleUsernameEnter}
              onMouseEnter={handleHover}
              placeholder={t('modding.tool.changename.placeholder')}
              maxLength={64}
              spellCheck={false}
            />
            <span className="modding-tool-desc">{t('modding.tool.changename.desc')}</span>
          </div>
        </div>

        {status && <div className="modding-status">{status}</div>}
      </div>
      </div>

      {/* ── Advanced RTM Mode: the full RTM trigger surface —
          rendered to the RIGHT of the main tools column. ── */}
      {devMode && (
        <div className="modding-card modding-dev-panel">
          <div className="modding-dev-header">
            <h3>{t('modding.dev.title')}</h3>
            <span>{t('modding.dev.desc')}</span>
          </div>

          <div className="modding-dev-section">
            <h4>{t('modding.dev.presets')}</h4>
            <div className="modding-dev-grid">
              {DEV_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={`modding-tool-btn modding-dev-btn ${isNavFocused((item) => item.kind === 'devPreset' && item.preset === preset) ? 'controller-focused' : ''}`}
                  title={preset.description}
                  onMouseEnter={handleHover}
                  onClick={() => void runDevPreset(preset)}
                  disabled={runningIndex !== null || devBusy || flowActive}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="modding-dev-section">
            <h4>{t('modding.dev.commands')}</h4>
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
                  {cmd.flag.replace(/^-/, '')}
                </button>
              ))}
            </div>
          </div>

          <div className="modding-dev-section">
            <h4>{t('modding.dev.args')}</h4>
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
                    {cmd.flag.replace(/^-/, '')}
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
            <h4>{t('modding.dev.toggles')}</h4>
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
      </div>

      <ModdingFlowModal
        theme={theme}
        stage={flow?.stage || null}
        copy={flow?.tool ? {
          askIntro: t(`modding.flow.${flow.tool.flowKey}.ask`),
          workingTitle: t('modding.flow.workingTitle'),
          workingIntro: t('modding.flow.workingIntro'),
          instructionTitle: t(`modding.flow.${flow.tool.flowKey}.instruction`),
          instructionBody: t(`modding.flow.${flow.tool.flowKey}.body`),
          instructionButton: t(`modding.flow.${flow.tool.flowKey}.button`),
        } : null}
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
