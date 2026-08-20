import React, { useEffect, useMemo, useRef, useState } from 'react'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { focusTextInput } from '../utils/keyboard'
import { useAuth } from './AuthProvider'
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase'
import { isTauriRuntime, runJupiterPrepSequence, writeJupiterCbufCommand } from '../utils/jupiterRtm'
import { getJupiterConfigCommand, JUPITER_MAPS, JUPITER_MODES, PLUNDER_DEFAULT_CASH } from '../utils/jupiterCommands'
import JupiterErrorModal from './JupiterErrorModal'
import JupiterHostPromptModal from './JupiterHostPromptModal'
import JupiterMapBadge from './JupiterMapBadge'
import CustomSelect from './CustomSelect'
import { appInstanceId, registerOwnedServer, unregisterOwnedServer } from '../utils/serverPresence'

const IW8_VERSIONS = ['1.44', '1.64', 'Other']
const IW8_MAPS = {
  '1.44': ['Verdansk', 'Rebirth Island'],
  '1.64': ['Rebirth Island', "Fortune's Keep", 'Caldera'],
  Other: ['Verdansk', 'Rebirth Island'],
}
const IW8_MODES = {
  '1.44': ['Plunder', 'Battle Royal', 'Better Plunder', 'Ressurgence'],
  '1.64': ['Plunder', 'Battle Royal', 'Better Plunder', 'Ressurgence', 'Vanguard Royal'],
  Other: ['Plunder', 'Battle Royal', 'Better Plunder', 'Ressurgence'],
}
// Jupiter maps/modes come from jupiterCommands.js — the single source of
// truth synced to wz commands.txt (broken modes are not exposed there).
const REGIONS = ['North America', 'Europe', 'Asia Pacific']

const MEMBER_POLL_MS = 5000
const STALE_MEMBER_CUTOFF_MIN = 10

const first = (items) => items[0]

// `theme` is the SHELL style (which mod's UI chrome is drawn — CSS classes,
// sounds, in-view Back button visibility). `mod` is the CONTENT mod (which
// mod's maps/modes, prep flow, publish pipeline and dashboard apply). They're
// decoupled so Dynamic Interfaces can swap the shell without changing the
// content.
export default function HostMatch({ theme = 'iw8', mod = theme, onBack, initialInputMode = 'mouse' }) {
  const isJupiterStyle = theme === 'jupiter'
  const isJupiterContent = mod === 'jupiter'
  const hoverSound = isJupiterStyle ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiterStyle ? 'jupSelect' : 'iw8Select'
  const { user } = useAuth()
  const [inputMode, setInputMode] = useState(initialInputMode)
  const [status, setStatus] = useState('Configure your lobby, then deploy it.')
  const [submitting, setSubmitting] = useState(false)
  const [errorModal, setErrorModal] = useState(null)
  const [form, setForm] = useState({
    serverName: '',
    version: '1.44',
    map: 'Verdansk',
    mode: 'Battle Royal',
    publicity: 'Public',
    region: 'North America',
    // LAN Session — a text field where the host pastes the LAN session
    // code the game client needs when connecting to this server.
    // Empty means no LAN session.
    lanSession: '',
    // Plunder-only: cash amount needed to win (file default 2000000000
    // when left blank).
    plunderCash: '',
    password: '',
  })

  // ── Hosting state ───────────────────────────────────────────────────────
  // When `hosted` is set (Jupiter only), the form is replaced by the live
  // hosting dashboard: player list, map/mode change, close server.
  const [hosted, setHosted] = useState(null)
  const [players, setPlayers] = useState([])
  // Jupiter host-entry prompt: "Prep PHA Client?" Yes runs the -lua prep
  // sequence then shows the PHA-client instructions modal (OK → the form);
  // No skips the prep (already in the lobby) and goes straight to the form.
  // The LAN session is NEVER collected here — the host pastes it in the form
  // below.
  const [hostPrompt, setHostPrompt] = useState(null) // null | 'ask' | 'prepping' | 'instructions'
  const promptStartedRef = useRef(false)
  const prepAbortRef = useRef(null)
  // Re-attach is checked on mount before the prompt decides — a live lobby
  // found here goes straight to the dashboard instead of asking the question.
  const [recheckDone, setRecheckDone] = useState(false)

  const availableMaps = isJupiterContent ? JUPITER_MAPS : IW8_MAPS[form.version]
  const availableModes = isJupiterContent ? JUPITER_MODES : IW8_MODES[form.version]

  // Re-attach to a live lobby from THIS app instance (e.g. the user navigated
  // away from Host a Match and came back — the lobby is still up). Also gates
  // the host-entry prompt: the prompt waits for this check to settle so it
  // never pops over an already-live dashboard.
  useEffect(() => {
    if (!isJupiterContent) return
    let mounted = true
    ;(async () => {
      if (user?.id && SUPABASE_CONFIGURED && supabase) {
        try {
          const { data, error } = await supabase
            .from('servers')
            .select('*')
            .eq('host_user_id', user.id)
            .eq('instance_id', appInstanceId)
            .limit(1)
          if (!error && data && data.length > 0 && mounted) {
            registerOwnedServer(data[0].id, user.id)
            setHosted(data[0])
            setStatus(`Lobby live: ${data[0].name} · ${data[0].map} · ${data[0].mode}`)
          }
        } catch (err) {
          console.warn('[host] re-attach failed', err)
        }
      }
      if (mounted) setRecheckDone(true)
    })()
    return () => {
      mounted = false
    }
  }, [isJupiterContent, user?.id])

  // ── Jupiter host-entry prompt (once per mount, after re-attach settles) ─
  useEffect(() => {
    if (!isJupiterContent || promptStartedRef.current || hosted || !recheckDone) return
    if (!isTauriRuntime()) return // browser dev mode has no RTM.exe
    promptStartedRef.current = true
    setHostPrompt('ask')
  }, [isJupiterContent, hosted, recheckDone])

  // "Prep PHA Client?" → Yes: run the -lua prep sequence, then show the
  // PHA-client instructions.
  const handlePromptYes = async () => {
    playSound(selectSound)
    setHostPrompt('prepping')
    setStatus('Preparing the local game menus…')
    const controller = new AbortController()
    prepAbortRef.current = controller
    try {
      await runJupiterPrepSequence(1500, controller.signal)
      if (controller.signal.aborted) return
      setHostPrompt('instructions')
      setStatus('Create the local game in the PHA Client, then return to the launcher.')
    } catch (error) {
      if (controller.signal.aborted) return // cancelled — state already reset
      setHostPrompt(null)
      setErrorModal({
        title: "COULDN'T PREPARE LOCAL GAME",
        message: error?.message || String(error) || 'RTM.exe failed.',
      })
    } finally {
      prepAbortRef.current = null
    }
  }

  // → No: skip the prep (already in the lobby), straight to the form.
  const handlePromptNo = () => {
    playSound(selectSound)
    setHostPrompt(null)
    setStatus('Configure your lobby below — paste the LAN session code, then create the lobby.')
  }

  // Cancel an in-flight prep sequence (aborts the AbortController and drops
  // straight to the form — the user can re-run the prep by leaving and
  // re-entering Host a Match, or create the local game manually).
  const handlePromptCancel = () => {
    playSound(selectSound)
    prepAbortRef.current?.abort()
    setHostPrompt(null)
    setStatus('Prep cancelled — configure your lobby below, or create the local game manually.')
  }

  // PHA instructions modal → OK: arrive at the Host a Match form.
  const handleInstructionsOk = () => {
    playSound(selectSound)
    setHostPrompt(null)
    setStatus('Configure your lobby below — paste the LAN session code, then create the lobby.')
  }

  // ── Live player list (dashboard) ────────────────────────────────────────
  useEffect(() => {
    if (!hosted || !SUPABASE_CONFIGURED || !supabase) return
    let disposed = false

    const pollMembers = async () => {
      try {
        // Prune stale rows (members who left without removing their row).
        const cutoff = new Date(Date.now() - STALE_MEMBER_CUTOFF_MIN * 60 * 1000).toISOString()
        await supabase
          .from('server_members')
          .delete()
          .eq('server_id', hosted.id)
          .lt('last_seen_at', cutoff)

        const { data } = await supabase
          .from('server_members')
          .select('id, display_name, player_code, user_id')
          .eq('server_id', hosted.id)
          .order('created_at', { ascending: true })
        if (!disposed && data) {
          setPlayers(data.map((member) => ({
            id: member.id,
            name: member.display_name || member.player_code || 'Player',
            isGuest: !member.user_id,
          })))
        }
      } catch (err) {
        console.warn('[host] member poll failed', err)
      }
    }

    void pollMembers()
    const interval = window.setInterval(pollMembers, MEMBER_POLL_MS)
    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [hosted])

  useEffect(() => {
    setForm((current) => ({
      ...current,
      map: availableMaps.includes(current.map) ? current.map : first(availableMaps),
      mode: availableModes.includes(current.mode) ? current.mode : first(availableModes),
    }))
  }, [form.version, isJupiterContent, availableMaps, availableModes])

  const fields = useMemo(() => {
    const baseFields = isJupiterContent
      ? ['serverName', 'map', 'mode', ...(form.mode === 'Plunder' ? ['plunderCash'] : []), 'publicity', 'region', 'lanSession']
      : ['serverName', 'version', 'map', 'mode', 'publicity', 'region', 'lanSession']
    return form.publicity === 'Private'
      ? [...baseFields, 'password', 'deploy']
      : [...baseFields, 'deploy']
  }, [form.publicity, form.mode, isJupiterContent])

  // ── Grid navigation for the host form ──────────────────────────────────
  // The form is a 2-column CSS grid (serverName spans the full first row;
  // every other field fills left→right, top→bottom). Controller navigation
  // mirrors the grid instead of treating the fields as a plain vertical
  // stack: right from Map lands on Mode (they sit side by side), and
  // up/down stay in the same visual column. Each field's grid position is
  // recomputed whenever the visible fields change (Plunder cash, password).
  const fieldGrid = useMemo(() => {
    const positions = []
    let row = 0
    let col = 0
    fields.forEach((field, index) => {
      if (index === 0) {
        // First field (Server Name) spans the full row.
        positions.push({ row, span: 2 })
        row += 1
        return
      }
      if (col >= 2) {
        row += 1
        col = 0
      }
      positions.push({ row, col, span: 1 })
      col += 1
    })
    return positions
  }, [fields])

  const navigateField = (direction, currentIndex) => {
    const count = fields.length
    if (count < 2) return currentIndex
    const pos = fieldGrid[currentIndex]
    if (!pos) return currentIndex
    // Left/right follow the reading order (col 1 → col 2 → next row's col 1).
    if (direction === 'left' || direction === 'right') {
      return (currentIndex + (direction === 'right' ? 1 : -1) + count) % count
    }
    // Up/down stay in the same visual column; the full-width row (span 2)
    // matches any column. Falls back to a linear step when the column has
    // no neighbor in that direction.
    const targetCol = pos.span === 2 ? null : pos.col
    const sameColumn = []
    fieldGrid.forEach((p, i) => {
      if (i === currentIndex) return
      if (targetCol === null || p.span === 2 || p.col === targetCol) sameColumn.push({ i, row: p.row })
    })
    sameColumn.sort((a, b) => a.row - b.row)
    if (direction === 'up') {
      const above = sameColumn.filter((m) => m.row < pos.row)
      return above.length > 0 ? above[above.length - 1].i : (currentIndex - 1 + count) % count
    }
    const below = sameColumn.filter((m) => m.row > pos.row)
    return below.length > 0 ? below[0].i : (currentIndex + 1 + count) % count
  }

  // Select changes are single-action events → sound is appropriate.
  const updateSelectField = (field, value) => {
    setInputMode('mouse')
    setForm((current) => ({ ...current, [field]: value }))
    playSound(selectSound)
  }

  // Text inputs (serverName / password) update state per keystroke silently,
  // then play the select cue when the value is "committed" (Enter or blur).
  const updateTextField = (field, value) => {
    setInputMode('mouse')
    setForm((current) => ({ ...current, [field]: value }))
  }

  const commitTextField = () => {
    setInputMode('mouse')
    playSound(selectSound)
  }

  const handleFieldHover = () => {
    setInputMode('mouse')
    playSound(hoverSound)
  }

  const handleFieldEscape = (event) => {
    if (event.key === 'Escape') handleBrowserBack('keyboard')
  }

  const handleTextFieldEnter = (event) => {
    if (event.key === 'Enter') {
      commitTextField()
    } else {
      handleFieldEscape(event)
    }
  }

  const handlePasswordEnter = (event) => {
    if (event.key === 'Enter') {
      handleDeploy('mouse')
    } else {
      handleFieldEscape(event)
    }
  }

  // Best-effort: push the WZ3 config cbuf to the host's client so the game
  // applies the selected map/mode (works once the local game exists).
  // Plunder lobbies carry the cash-to-win amount from the form.
  const applyHostConfig = async (map, mode) => {
    if (!isJupiterContent) return
    try {
      await writeJupiterCbufCommand(getJupiterConfigCommand({ map, mode, plunderCash: form.plunderCash }))
    } catch (error) {
      console.warn('[host] config cbuf failed', error)
    }
  }

  const publishLobby = async (lanSessionOverride) => {
    const lobbyName = form.serverName.trim() || 'Unnamed Lobby'
    if (SUPABASE_CONFIGURED && supabase) {
      if (!user) {
        setStatus(`Lobby ready: ${lobbyName} · ${form.map} · ${form.mode} — sign in to publish it to the server browser.`)
        playSound(selectSound)
        return null
      }
      setSubmitting(true)
      try {
        const { data: createdServer, error } = await supabase.from('servers').insert({
          host_user_id: user.id,
          name: lobbyName,
          version: isJupiterContent ? 'Jupiter' : form.version,
          map: form.map,
          mode: form.mode,
          region: form.region,
          is_private: form.publicity === 'Private',
          join_code: form.publicity === 'Private' && form.password.trim() ? form.password.trim() : null,
          lan_session: (lanSessionOverride ?? form.lanSession).trim() || null,
          // The server is a leased resource: the centralized presence module
          // renews this timestamp while the app is alive.
          last_heartbeat_at: new Date().toISOString(),
          // Mod filter (migration 0007) + stale-host cleanup instance id.
          mod: isJupiterContent ? 'jupiter' : 'iw8',
          instance_id: appInstanceId,
        }).select('*').single()
        if (error) throw error
        registerOwnedServer(createdServer?.id, user.id)
        setStatus(`Lobby live: ${lobbyName} · ${form.map} · ${form.mode} — now listed in the server browser.`)
        return createdServer
      } catch (err) {
        const detail = err?.message || String(err) || 'unknown error'
        setStatus(`Couldn't publish ${lobbyName}.`)
        setErrorModal({ title: `COULDN'T PUBLISH ${lobbyName}`, message: detail })
        return null
      } finally {
        setSubmitting(false)
      }
    }

    // Backend not configured — local-only creation.
    setStatus(`Lobby ready: ${lobbyName} · ${form.map} · ${form.mode}`)
    playSound(selectSound)
    return null
  }

  // Create Lobby from the form (manual path — prep modal was dismissed or
  // never started). Pushes the config cbuf, then publishes.
  const handleDeploy = async (source = 'mouse') => {
    if (submitting || hosted) return // one publish at a time — prevents duplicate rows
    if (form.publicity === 'Private' && !form.password.trim()) {
      setStatus('Add a password before creating a private lobby.')
      playSound(selectSound)
      return
    }
    setInputMode(source === 'gamepad' ? 'controller' : 'mouse')

    await applyHostConfig(form.map, form.mode)
    const created = await publishLobby(null)
    if (created && isJupiterContent) {
      setHosted(created)
    }
    playSound(selectSound)
  }

  // ── Dashboard actions ───────────────────────────────────────────────────
  const handleDashboardMapModeChange = async (field, value) => {
    if (!hosted) return
    const next = { ...hosted, [field]: value }
    setHosted(next)
    setStatus(`Updating lobby to ${next.map} · ${next.mode}…`)
    playSound(selectSound)

    try {
      const { error } = await supabase
        .from('servers')
        .update({ [field]: value })
        .eq('id', hosted.id)
        .eq('host_user_id', user?.id)
      if (error) throw error
      // Update our own client — members' clients detect it via their watcher.
      // The Plunder cash amount persists in the form and rides along.
      await applyHostConfig(next.map, next.mode)
      setStatus(`Lobby updated: ${next.map} · ${next.mode}. Players' clients update automatically.`)
    } catch (err) {
      setHosted(hosted) // revert on failure
      setErrorModal({
        title: `COULDN'T UPDATE ${hosted.name}`,
        message: err?.message || String(err) || 'Lobby update failed.',
      })
    }
  }

  const handleCloseServer = async () => {
    if (!hosted || submitting) return
    setSubmitting(true)
    playSound(selectSound)
    try {
      const { error } = await supabase
        .from('servers')
        .delete()
        .eq('id', hosted.id)
        .eq('host_user_id', user?.id)
      if (error) throw error
      unregisterOwnedServer(hosted.id)
      setHosted(null)
      setPlayers([])
      setStatus('Lobby closed and removed from the server browser.')
    } catch (err) {
      setErrorModal({
        title: `COULDN'T CLOSE ${hosted.name}`,
        message: err?.message || String(err) || 'Server deletion failed.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleHostHover = () => playSound(hoverSound)

  const handleBrowserBack = (source = 'mouse') => {
    playSound(selectSound)
    onBack?.(source)
  }

  // ── Custom dropdown state ───────────────────────────────────────────────
  // openSelect names the field whose option list is expanded (null = closed).
  // While open, the OPTION LIST becomes the controller nav target (the
  // options hook below) instead of the fields — this is what fixes the
  // native-select behavior where up/down scrolled every option and A just
  // flipped them. Works for the host form AND the dashboard's map/mode.
  const [openSelect, setOpenSelect] = useState(null)

  const SELECT_FIELDS = ['version', 'map', 'mode', 'publicity', 'region']
  const isSelectField = (field) => SELECT_FIELDS.includes(field)

  const selectFieldOptions = (field) => {
    if (field === 'version') return IW8_VERSIONS
    if (field === 'map') return availableMaps
    if (field === 'mode') return availableModes
    if (field === 'publicity') return ['Public', 'Private']
    if (field === 'region') return REGIONS
    return []
  }
  const openOptions = openSelect ? selectFieldOptions(openSelect) : []
  // Current value of the open field (form or dashboard) — the options hook
  // lands on it when the dropdown opens.
  const openCurrentValue = openSelect
    ? (hosted && isJupiterContent ? hosted[openSelect] : form[openSelect])
    : ''

  const toggleSelect = (field) => {
    setInputMode('mouse')
    playSound(selectSound)
    setOpenSelect((current) => (current === field ? null : field))
  }

  // ── Controller navigation: host form fields ─────────────────────────────
  const focusedIndex = useControllerNavigation({
    itemCount: fields.length,
    allowedDirections: ['up', 'down', 'left', 'right'],
    onNavigate: navigateField,
    onControllerActivity: () => setInputMode('controller'),
    onMove: (index) => {
      setInputMode('controller')
      playSound(hoverSound)
      const field = fields[index]
      if (field === 'deploy') setStatus('Press select to create this lobby.')
      else if (field === 'password') setStatus('Private lobby password — press select to create.')
      else if (field) {
        const label = { serverName: 'server name', lanSession: 'LAN session', plunderCash: 'plunder cash' }[field] || field
        setStatus(`Editing ${label}.`)
      }
    },
    onConfirm: (index, source) => {
      setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
      const field = fields[index]
      if (field === 'deploy') {
        handleDeploy(source)
        return
      }
      const label = { serverName: 'server name', lanSession: 'LAN session', plunderCash: 'plunder cash' }[field] || field
      if (isSelectField(field)) {
        playSound(selectSound)
        setOpenSelect(field)
        setStatus(`${label} — pick with up/down, A to select.`)
        return
      }
      focusTextInput(`[data-host-field="${field}"]`, setInputMode)
      setStatus(`Editing ${label}. Use on-screen keyboard to type.`)
    },
    enabled: !errorModal && !hosted && !hostPrompt && !openSelect,
    onBack: handleBrowserBack,
  })

  const isFocused = (field) => inputMode === 'controller' && fields[focusedIndex] === field

  // ── Controller navigation: hosting dashboard (map / mode / close) ───────
  const dashboardItems = ['map', 'mode', 'close']
  const dashboardFocusedIndex = useControllerNavigation({
    itemCount: hosted && isJupiterContent ? dashboardItems.length : 0,
    allowedDirections: ['up', 'down', 'left', 'right'],
    // Map and Mode sit side by side in the LOBBY CONTROL dashboard — left /
    // right hop between the two selects (Close Server lives below them).
    onNavigate: (direction, currentIndex) => {
      if (direction === 'left' || direction === 'right') {
        return direction === 'left' ? 0 : 1
      }
      return direction === 'up' ? Math.max(0, currentIndex - 1) : Math.min(2, currentIndex + 1)
    },
    onControllerActivity: () => setInputMode('controller'),
    onMove: (index) => {
      setInputMode('controller')
      playSound(hoverSound)
      const item = dashboardItems[index]
      setStatus(item === 'close'
        ? 'Close Server — removes the lobby from the server browser.'
        : `Change the ${item} — every joined player's client updates automatically.`)
    },
    onConfirm: (index, source) => {
      setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
      const item = dashboardItems[index]
      if (item === 'close') {
        handleCloseServer()
        return
      }
      playSound(selectSound)
      setOpenSelect(item)
      setStatus(`Pick the ${item} with up/down, A to select.`)
    },
    enabled: Boolean(hosted && isJupiterContent) && !errorModal && !hostPrompt && !openSelect,
    onBack: handleBrowserBack,
  })

  const dashboardIsFocused = (item) => inputMode === 'controller' && dashboardFocusedIndex === dashboardItems.indexOf(item)

  // ── Controller navigation: open dropdown's option list ──────────────────
  // Mounts only while a dropdown is open; its nav replaces the fields /
  // dashboard nav so up/down moves through OPTIONS and A confirms one (B /
  // Esc closes without changing). Lands on the current value when opened.
  const optionFocusedIndex = useControllerNavigation({
    itemCount: openOptions.length,
    initialIndex: openSelect ? Math.max(0, openOptions.indexOf(openCurrentValue)) : 0,
    allowedDirections: ['up', 'down'],
    onControllerActivity: () => setInputMode('controller'),
    onMove: (index) => {
      setInputMode('controller')
      playSound(hoverSound)
      setStatus(`Pick ${openOptions[index]} — A to select, B to cancel.`)
    },
    onConfirm: (index, source) => {
      const value = openOptions[index]
      if (!openSelect || value === undefined) return
      setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
      playSound(selectSound)
      if (hosted && isJupiterContent) {
        void handleDashboardMapModeChange(openSelect, value)
      } else {
        setForm((current) => ({ ...current, [openSelect]: value }))
        setStatus(`Set to ${value}.`)
      }
      setOpenSelect(null)
    },
    onBack: () => {
      playSound(selectSound)
      setOpenSelect(null)
      setStatus('Selection cancelled.')
    },
    enabled: Boolean(openSelect) && !errorModal && !hostPrompt,
  })

  // ══════════════════════════════════════════════════════════════════════
  // HOSTING DASHBOARD (Jupiter, after Create Lobby)
  // ══════════════════════════════════════════════════════════════════════
  if (hosted && isJupiterContent) {
    return (
      <section className={`host-match ${isJupiterStyle ? 'host-match-jupiter' : 'host-match-iw8'}`}>
        <div className="host-match-heading">
          <div>
            <span className="host-match-kicker">PLAY / HOSTING</span>
            <h1>LOBBY CONTROL</h1>
            <p>Your lobby is live — manage players and the match configuration.</p>
          </div>
        </div>

        <div className="host-dashboard">
          <div className="host-dashboard-main">
            <div className="host-dashboard-lobby">
              <span className="host-dashboard-kicker">LIVE LOBBY</span>
              <h2>{hosted.name}</h2>
              <div className="host-dashboard-line"><span>Region</span><strong>{hosted.region || '—'}</strong></div>
              <div className="host-dashboard-line"><span>LAN Session</span><strong className="host-dashboard-session">{hosted.lan_session || '—'}</strong></div>
              <div className="host-dashboard-line"><span>Status</span><strong className="host-dashboard-live">LIVE</strong></div>
              <div className="host-dashboard-mapmode">
                <label className={dashboardIsFocused('map') ? 'controller-focused' : ''} onMouseEnter={handleHostHover}>
                  <span>Map</span>
                  <CustomSelect
                    value={hosted.map}
                    options={JUPITER_MAPS}
                    onSelect={(value) => void handleDashboardMapModeChange('map', value)}
                    isOpen={openSelect === 'map'}
                    onToggle={() => toggleSelect('map')}
                    onClose={() => setOpenSelect(null)}
                    focusIndex={openSelect === 'map' ? optionFocusedIndex : null}
                    theme={theme}
                    ariaLabel="Map"
                  />
                </label>
                <label className={dashboardIsFocused('mode') ? 'controller-focused' : ''} onMouseEnter={handleHostHover}>
                  <span>Mode</span>
                  <CustomSelect
                    value={hosted.mode}
                    options={JUPITER_MODES}
                    onSelect={(value) => void handleDashboardMapModeChange('mode', value)}
                    isOpen={openSelect === 'mode'}
                    onToggle={() => toggleSelect('mode')}
                    onClose={() => setOpenSelect(null)}
                    focusIndex={openSelect === 'mode' ? optionFocusedIndex : null}
                    theme={theme}
                    ariaLabel="Mode"
                  />
                </label>
              </div>
              <p className="host-dashboard-hint">Changing the map or mode updates your client and every joined player's client automatically.</p>
            </div>

            {/* Right column: the live player list with the big CURRENT MAP
                HUD pinned beneath it — the dashboard's map/mode selects
                drive the badge, and members' clients follow along via their
                watcher. */}
            <div className="host-dashboard-right">
              <div className="host-dashboard-players">
                <div className="host-dashboard-players-header">
                  <span className="host-dashboard-kicker">IN THE GAME</span>
                  <strong>{players.length}</strong>
                </div>
                <div className="host-dashboard-players-list">
                  {players.length === 0 && <div className="host-dashboard-players-empty">No players yet — share your LAN session code and wait for squads.</div>}
                  {players.map((player) => (
                    <div key={player.id} className={`host-dashboard-player ${player.isGuest ? 'guest' : ''}`}>
                      <span className="host-dashboard-player-avatar">{player.name[0]?.toUpperCase() || '?'}</span>
                      <span className="host-dashboard-player-name">{player.name}</span>
                      {player.isGuest && <span className="host-dashboard-player-tag">GUEST</span>}
                    </div>
                  ))}
                </div>
              </div>
              <JupiterMapBadge map={hosted.map} mode={hosted.mode} theme={theme} />
            </div>
          </div>

          <div className="host-dashboard-actions">
            <button
              type="button"
              className={`host-dashboard-close ${dashboardIsFocused('close') ? 'controller-focused' : ''}`}
              onMouseEnter={handleHostHover}
              onClick={handleCloseServer}
              disabled={submitting}
            >
              {submitting ? 'Closing…' : 'Close Server'}
            </button>
          </div>
          <div className="host-match-status">{status}</div>
        </div>

        <JupiterErrorModal
          theme={theme}
          isOpen={Boolean(errorModal)}
          title={errorModal?.title}
          message={errorModal?.message}
          onClose={() => setErrorModal(null)}
        />
      </section>
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  // HOST FORM
  // ══════════════════════════════════════════════════════════════════════
  return (
    <section className={`host-match ${isJupiterStyle ? 'host-match-jupiter' : 'host-match-iw8'}`}>
      <div className="host-match-heading">
        <div>
          <span className="host-match-kicker">PLAY / CREATE</span>
          <h1>HOST A MATCH</h1>
          <p>{isJupiterContent ? 'Jupiter prepares a local game — create it in the PHA Client, then deploy the lobby.' : 'Build a lobby for your squad and set the rules before launch.'}</p>
        </div>
        {/* Jupiter shells hide the in-view Back button — the header back
            arrow returns to the main menu instead. IW8 shells keep it. Esc /
            controller Back still works on both. */}
        {!isJupiterStyle && (
          <button type="button" className="host-match-back" onMouseEnter={handleHostHover} onClick={() => handleBrowserBack('mouse')}>Back</button>
        )}
      </div>

      <div className="host-match-layout">
        <div className="host-match-form">
          <label className={`host-match-field ${isFocused('serverName') ? 'controller-focused' : ''}`} onMouseEnter={handleFieldHover}>
            <span>Server Name</span>
            <input
              data-host-field="serverName"
              value={form.serverName}
              onChange={(event) => updateTextField('serverName', event.target.value)}
              onBlur={commitTextField}
              onKeyDown={handleTextFieldEnter}
              placeholder="Name your lobby"
            />
          </label>

          {!isJupiterContent && (
            <label className={`host-match-field ${isFocused('version') ? 'controller-focused' : ''}`} onMouseEnter={handleFieldHover}>
              <span>IW8 Version</span>
              <CustomSelect
                value={form.version}
                options={IW8_VERSIONS}
                onSelect={(value) => updateSelectField('version', value)}
                isOpen={openSelect === 'version'}
                onToggle={() => toggleSelect('version')}
                onClose={() => setOpenSelect(null)}
                focusIndex={openSelect === 'version' ? optionFocusedIndex : null}
                theme={theme}
                ariaLabel="IW8 Version"
              />
            </label>
          )}

          <label className={`host-match-field ${isFocused('map') ? 'controller-focused' : ''}`} onMouseEnter={handleFieldHover}>
            <span>Map</span>
            <CustomSelect
              value={form.map}
              options={availableMaps}
              onSelect={(value) => updateSelectField('map', value)}
              isOpen={openSelect === 'map'}
              onToggle={() => toggleSelect('map')}
              onClose={() => setOpenSelect(null)}
              focusIndex={openSelect === 'map' ? optionFocusedIndex : null}
              theme={theme}
              ariaLabel="Map"
            />
          </label>

          <label className={`host-match-field ${isFocused('mode') ? 'controller-focused' : ''}`} onMouseEnter={handleFieldHover}>
            <span>Mode</span>
            <CustomSelect
              value={form.mode}
              options={availableModes}
              onSelect={(value) => updateSelectField('mode', value)}
              isOpen={openSelect === 'mode'}
              onToggle={() => toggleSelect('mode')}
              onClose={() => setOpenSelect(null)}
              focusIndex={openSelect === 'mode' ? optionFocusedIndex : null}
              theme={theme}
              ariaLabel="Mode"
            />
          </label>

          {/* Plunder-only: cash amount required to win. Left blank → the
              file's default (2000000000) is used in the config command. */}
          {isJupiterContent && form.mode === 'Plunder' && (
            <label className={`host-match-field ${isFocused('plunderCash') ? 'controller-focused' : ''}`} onMouseEnter={handleFieldHover}>
              <span>Plunder Cash</span>
              <input
                data-host-field="plunderCash"
                type="text"
                inputMode="numeric"
                value={form.plunderCash}
                onChange={(event) => updateTextField('plunderCash', event.target.value)}
                onBlur={commitTextField}
                onKeyDown={handleTextFieldEnter}
                placeholder={`Cash to win — default ${PLUNDER_DEFAULT_CASH.toLocaleString('en-US')}`}
                maxLength={10}
                spellCheck={false}
              />
            </label>
          )}

          <label className={`host-match-field ${isFocused('publicity') ? 'controller-focused' : ''}`} onMouseEnter={handleFieldHover}>
            <span>Publicity</span>
            <CustomSelect
              value={form.publicity}
              options={['Public', 'Private']}
              onSelect={(value) => {
                updateSelectField('publicity', value)
                if (value === 'Public') setForm((current) => ({ ...current, password: '' }))
              }}
              isOpen={openSelect === 'publicity'}
              onToggle={() => toggleSelect('publicity')}
              onClose={() => setOpenSelect(null)}
              focusIndex={openSelect === 'publicity' ? optionFocusedIndex : null}
              theme={theme}
              ariaLabel="Publicity"
            />
          </label>

          <label className={`host-match-field ${isFocused('region') ? 'controller-focused' : ''}`} onMouseEnter={handleFieldHover}>
            <span>Region</span>
            <CustomSelect
              value={form.region}
              options={REGIONS}
              onSelect={(value) => updateSelectField('region', value)}
              isOpen={openSelect === 'region'}
              onToggle={() => toggleSelect('region')}
              onClose={() => setOpenSelect(null)}
              focusIndex={openSelect === 'region' ? optionFocusedIndex : null}
              theme={theme}
              ariaLabel="Region"
            />
          </label>

          <label className={`host-match-field ${isFocused('lanSession') ? 'controller-focused' : ''}`} onMouseEnter={handleFieldHover}>
            <span>LAN Session</span>
            <input
              data-host-field="lanSession"
              type="text"
              value={form.lanSession}
              onChange={(event) => updateTextField('lanSession', event.target.value)}
              onBlur={commitTextField}
              onKeyDown={handleTextFieldEnter}
              placeholder="Paste your LAN session code"
              spellCheck={false}
            />
          </label>

          {form.publicity === 'Private' && (
            <label className={`host-match-field ${isFocused('password') ? 'controller-focused' : ''}`} onMouseEnter={handleFieldHover}>
              <span>Password</span>
              <input
                data-host-field="password"
                type="password"
                value={form.password}
                onChange={(event) => updateTextField('password', event.target.value)}
                onBlur={commitTextField}
                onKeyDown={handlePasswordEnter}
                placeholder="Required for private lobbies"
              />
            </label>
          )}
        </div>

        <aside className="host-match-summary" onMouseEnter={handleFieldHover}>
          <span className="host-match-summary-label">LOBBY PREVIEW</span>
          <h2>{form.serverName.trim() || 'Unnamed Lobby'}</h2>
          <div className="host-match-summary-line"><span>Version</span><strong>{isJupiterContent ? 'JUPITER' : form.version}</strong></div>
          <div className="host-match-summary-line"><span>Map</span><strong>{form.map}</strong></div>
          <div className="host-match-summary-line"><span>Mode</span><strong>{form.mode}</strong></div>
          <div className="host-match-summary-line"><span>Access</span><strong>{form.publicity}</strong></div>
          <div className="host-match-summary-line"><span>Region</span><strong>{form.region}</strong></div>
          <button type="button" className={`host-match-deploy ${isFocused('deploy') ? 'controller-focused' : ''}`} onMouseEnter={handleHostHover} onClick={() => handleDeploy('mouse')} disabled={submitting}>{submitting ? 'Publishing…' : 'Create Lobby'}</button>
          <div className="host-match-status">{status}</div>
        </aside>
      </div>

      {/* Host entry prompt (Jupiter content): "Prep PHA Client?" → prep + instructions */}
      {isJupiterContent && (
        <JupiterHostPromptModal
          theme={theme}
          prompt={hostPrompt}
          onYes={handlePromptYes}
          onNo={() => void handlePromptNo()}
          onOk={handleInstructionsOk}
          onCancel={handlePromptCancel}
        />
      )}
      <JupiterErrorModal
        theme={theme}
        isOpen={Boolean(errorModal)}
        title={errorModal?.title}
        message={errorModal?.message}
        onClose={() => setErrorModal(null)}
      />
    </section>
  )
}
