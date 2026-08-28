import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { playSound } from './audio'
import { duckModeMusic, restoreModeMusic } from './music'
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import { useSettings } from '../components/SettingsProvider'
import { buildDevServer } from './devServer'
import { getDisplayName } from './displayName'
import {
  isTauriRuntime,
  joinJupiterLanSession,
  runJupiterPrepSequence,
  runRtm,
  writeJupiterCbufCommand,
  writeJupiterLuaCommand,
  wait,
} from './jupiterRtm'
import { getJupiterConfigCommand, modeNeedsConfig } from './jupiterCommands'
import JupiterJoinModal from '../components/JupiterJoinModal'
import JupiterErrorModal from '../components/JupiterErrorModal'

// ──────────────────────────────────────────────────────────────────────────────
// JupiterSessionProvider
//
// Owns everything an active Jupiter game session needs while the launcher is
// open:
//   • The join flow: warzone runs the lua prep sequence
//     (-lua MainMenuOffline → 2 s → -lua WarzonePrivateMatchLobby → 2 s →
//     -lua MainMenuOffline) then shows the guided PHA-Client modal —
//     Continue runs the config cbuf → 2 s → connect (-join "<session>";
//     the tool writes the trigger files itself: req_execcmd.ntc,
//     command.txt, cbufcmd). Zombies and multiplayer skip the prep and go
//     straight to the modal (click Local Play, don't create yet); zombies
//     writes -setzombies before connecting, and neither pushes a config cbuf.
//   • server_members registration + heartbeat so the host sees who is in
//     their lobby.
//   • A watcher on the joined server row: if the host changes map/mode the
//     member's client auto-runs the new config cbuf (themed toast feedback).
//   • The party auto-join watcher: when the party leader joins a server,
//     every member's client runs the same join flow automatically.
//   • Party-invite notifications (toast with Accept/Decline).
//
// Renders the Jupiter join modal + error modal globally so the flow works
// from the Server Browser AND from party auto-joins triggered on any screen.
// ──────────────────────────────────────────────────────────────────────────────

const PREP_GAP_MS = 1500
const CBUF_TO_JOIN_GAP_MS = 1500
const SERVER_WATCH_MS = 5000
const PARTY_WATCH_MS = 8000
const PARTY_MEMBERS_WATCH_MS = 10000
const INVITE_WATCH_MS = 10000

const SessionContext = createContext(null)

export function useJupiterSession() {
  return useContext(SessionContext)
}

function makePlayerCode() {
  return `Player#${100000 + Math.floor(Math.random() * 900000)}`
}

export default function JupiterSessionProvider({ theme = 'jupiter', children }) {
  const { user } = useAuth()
  // The dev server's "host" is the Options > Developer settings — the
  // settings-driven map/mode watcher below reads them to mirror the
  // host-change behavior of real servers.
  const { settings } = useSettings()

  // Auto-Load Save Data (Options > Auto-Load Save Data): on every Jupiter
  // interface entry, write the loadstatus trigger so classes / operator / settings
  // come back. Lives here because this provider wraps ALL Jupiter content
  // (both shells), mounting exactly when the Jupiter interface opens.
  useEffect(() => {
    if (!settings?.auto_load_savedata || !isTauriRuntime()) return undefined
    let active = true
    runRtm(['-loaddata']).catch((error) => {
      if (active) console.warn('[savedata] auto-load failed', error)
    })
    return () => { active = false }
  }, [settings?.auto_load_savedata])

  // `theme` selects the modal styling + sound set.
  const isJupiter = theme === 'jupiter'
  const hoverSound = 'jupHover'
  const selectSound = 'jupSelect'
  const [join, setJoin] = useState(null)
  const [errorModal, setErrorModal] = useState(null)
  const [toasts, setToasts] = useState([])
  // Last successfully-connected lobby. Survives `finishJoin` so the CURRENT
  // MAP HUD keeps showing the map after the user dismisses the result modal
  // (they are still in-game) — cleared when a new join flow starts, the
  // server closes, or the provider unmounts.
  const [lastLobby, setLastLobby] = useState(null)
  // The current party's member roster (user_id + name + region) for the
  // right-side player cards. Polled so joining/leaving a party shows up
  // within a few seconds. Empty when signed out, unconfigured, or not in a
  // party.
  const [partyMembers, setPartyMembers] = useState([])
  // Everyone currently sitting in the joined lobby (server_members), for
  // the right-side player roster once you're connected — NOT just your
  // party. Polled while connected; empty otherwise.
  const [lobbyMembers, setLobbyMembers] = useState([])

  const joinRef = useRef(null)
  const joinTokenRef = useRef(0)
  // The server we last joined (survives `finishJoin` so the lobby roster
  // keeps polling after the result modal is dismissed — the player is
  // still in the game). Cleared when a new join flow starts or the server
  // closes.
  const lastServerIdRef = useRef(null)
  // Our own membership in that lobby (memberId / memberCode) so the roster
  // can keep showing us after `finishJoin` deletes our server_members row.
  const lastMemberRef = useRef(null)
  // Known lobby members (per lobby) so a NEW arrival while we're in the
  // server plays the player-join cue. Seeds on the first poll for a lobby
  // (players already present when we arrive don't all fire at once); later
  // polls chime once per new arrival and drop absent keys, so a leave +
  // rejoin chimes again.
  const knownLobbyMembersRef = useRef(null)
  const knownInviteIdsRef = useRef(new Set())
  // Guards against the party watcher re-triggering the join flow for the
  // same leader server after the member finishes/leaves — a fresh join is
  // only auto-started when the leader's server actually changes.
  const lastAutoJoinServerIdRef = useRef(null)

  joinRef.current = join

  // ── Toasts ──────────────────────────────────────────────────────────────
  const dismissToast = useCallback((toastId) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId))
  }, [])

  const pushToast = useCallback((kind, title, message, actions) => {
    const toast = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind, title, message, actions }
    setToasts((current) => [...current.slice(-2), toast])
    if (kind === 'info') {
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id))
      }, 6000)
    }
  }, [])

  const showError = useCallback((title, message) => {
    setErrorModal({ title, message })
  }, [])

  // ── Party roster (home-screen player cards) ─────────────────────────────
  const refreshPartyMembers = useCallback(async () => {
    if (!user?.id || !SUPABASE_CONFIGURED || !supabase) {
      setPartyMembers([])
      return
    }
    try {
      const { data: memberships } = await supabase
        .from('party_members')
        .select('party_id')
        .eq('user_id', user.id)
        .limit(1)
      const partyId = memberships?.[0]?.party_id
      if (!partyId) {
        setPartyMembers([])
        return
      }
      const { data: memberRows } = await supabase
        .from('party_members')
        .select('user_id')
        .eq('party_id', partyId)
      const memberIds = (memberRows || []).map((member) => member.user_id)
      if (memberIds.length === 0) {
        setPartyMembers([])
        return
      }
      // Regions come from the public profile_names view (migration 0009).
      const { data: profiles } = await supabase
        .from('profile_names')
        .select('user_id, username, display_name, region')
        .in('user_id', memberIds)
      const profileMap = {}
      for (const profile of profiles || []) profileMap[profile.user_id] = profile
      setPartyMembers(
        memberIds.map((memberId) => ({
          userId: memberId,
          name: profileMap[memberId]?.username || profileMap[memberId]?.display_name || 'Unknown',
          region: profileMap[memberId]?.region || '',
        }))
      )
    } catch (partyError) {
      console.warn('[session] party roster refresh failed', partyError)
    }
  }, [user?.id])

  // Poll the party roster so the home screen's player cards stay fresh
  // (join/leave/create/disband from any screen shows up within ~10 s).
  useEffect(() => {
    if (!user?.id || !SUPABASE_CONFIGURED || !supabase) return undefined
    void refreshPartyMembers()
    const interval = window.setInterval(() => void refreshPartyMembers(), PARTY_MEMBERS_WATCH_MS)
    return () => window.clearInterval(interval)
  }, [refreshPartyMembers])

  // ── Party helpers ────────────────────────────────────────────────────────
  const getMyParty = useCallback(async () => {
    if (!user?.id || !SUPABASE_CONFIGURED || !supabase) return null
    const { data: memberships } = await supabase
      .from('party_members')
      .select('party_id')
      .eq('user_id', user.id)
      .limit(1)
    const partyId = memberships?.[0]?.party_id
    if (!partyId) return null
    const { data: party } = await supabase.from('parties').select('*').eq('id', partyId).single()
    return party || null
  }, [user?.id])

  const setLeaderServer = useCallback(async (serverId) => {
    if (!user?.id) return
    const party = await getMyParty()
    if (party && party.leader_user_id === user.id) {
      const { error } = await supabase
        .from('parties')
        .update({ leader_server_id: serverId })
        .eq('id', party.id)
      if (error) console.warn('[session] could not broadcast leader server', error)
    }
  }, [getMyParty, user?.id])

  const clearLeaderServer = useCallback(async (serverId) => {
    if (!user?.id) return
    const party = await getMyParty()
    if (party && party.leader_user_id === user.id) {
      const { error } = await supabase
        .from('parties')
        .update({ leader_server_id: null })
        .eq('id', party.id)
        .eq('leader_server_id', serverId)
      if (error) console.warn('[session] could not clear leader server', error)
    }
  }, [getMyParty, user?.id])

  // ── Join flow ────────────────────────────────────────────────────────────
  // AbortController for the prep sequence — lets the user cancel during
  // the 'preparing' stage via Esc / controller-Back on the join modal.
  const joinAbortRef = useRef(null)

  const cancelJoin = useCallback(() => {
    joinAbortRef.current?.abort()
    joinAbortRef.current = null
    joinTokenRef.current += 1 // invalidate any in-flight stage transitions
    setJoin(null)
    // The join never happened — bring the launcher music back up.
    restoreModeMusic()
  }, [])

  const beginJoin = useCallback(async (server, source = 'browser') => {
    if (joinRef.current) return // one active session at a time
    const token = joinTokenRef.current + 1
    joinTokenRef.current = token
    // A fresh join flow starts from a clean slate — any previous lobby's
    // HUD state is discarded.
    setLastLobby(null)

    const controller = new AbortController()
    joinAbortRef.current = controller

    const session = {
      stage: 'preparing',
      source,
      serverId: server.id,
      serverName: server.name,
      map: server.map,
      mode: server.mode,
      lanSession: server.lanSession,
      memberId: null,
      memberCode: null,
      // The lobby's game mode — decides whether the exec-hash config cbuf
      // applies (warzone only; multiplayer/zombies need just the LAN join).
      gameMode: server.gameMode || server.game_mode || 'multiplayer',
      // Dev-server joins (Developer Mode test server) are fully local: no
      // server_members registration, no host watcher, no party broadcast.
      isDevServer: Boolean(server.isDevServer),
    }
    setJoin(session)
    // A fresh join flow starts from a clean slate — the old lobby's
    // roster is discarded.
    setLobbyMembers([])
    playSound(selectSound)
    // Joining a match: duck the launcher soundtrack so the game's audio is
    // unobstructed. It fades back in on leaveServer (or a cancelled join).
    duckModeMusic()

    // Zombies and multiplayer matches are configured natively by the game's
    // own lobby, so their join flow goes straight to a guided modal ("click
    // Local Play — don't create the game yet") with NO prep sequence. The
    // switch to zombies mode (-setzombies) and/or the LAN join happen when
    // the user presses Continue.
    const isSimplyGuided = session.gameMode === 'zombies' || session.gameMode === 'multiplayer'
    if (isSimplyGuided) {
      if (joinTokenRef.current !== token) return
      setJoin((current) => current ? { ...current, stage: 'guided' } : current)
      return
    }

    // Warzone still runs the prep sequence (drive the PHA Client menus) so
    // the user ends up in the Create Local Game screen. No keyboard auto-
    // navigation — the guided modal walks the user through it instead.
    try {
      await runJupiterPrepSequence(PREP_GAP_MS, controller.signal)
      joinAbortRef.current = null

      if (joinTokenRef.current !== token) return
      setJoin((current) => current ? { ...current, stage: 'guided' } : current)
    } catch (error) {
      joinAbortRef.current = null
      if (joinTokenRef.current !== token) return
      // AbortError means the user cancelled — no error modal.
      if (error?.name === 'AbortError') { setJoin(null); return }
      setJoin(null)
      // The prep failed — no match was reached, so the music comes back.
      restoreModeMusic()
      showError(`COULDN'T PREPARE ${server.name}`, error?.message || String(error) || 'RTM trigger write failed.')
    }
  }, [selectSound, showError])

  // Send the config cbuf + -join, register the member, and land on the
  // 'result' stage. Shared by Continue (guided) and Retry (result) so a
  // failed attempt can be re-run without repeating the prep sequence.
  const sendAndJoin = useCallback(async () => {
    const current = joinRef.current
    if (!current) return
    const token = joinTokenRef.current

    setJoin((prev) => prev ? { ...prev, stage: 'sending' } : prev)
    try {
      // The ONE difference between a dev-server join and a real one: without
      // a LAN session there is nothing to send or connect to, so the map/mode
      // config cbuf and the -join are skipped. The flow itself (prep, guided
      // modal, result, HUD) runs exactly like a real lobby either way.
      const hasLanSession = typeof current.lanSession === 'string' && current.lanSession.trim() !== ''
      if (!current.isDevServer || hasLanSession) {
        // Zombies: the user clicks Local Play (guided modal), then Continue
        // switches the game client into zombies mode before connecting. This
        // is the mode-switch the user asked for at the point of action, not
        // on mounting the mode menu.
        if (current.gameMode === 'zombies') {
          await runRtm(['-setzombies'])
          await wait(CBUF_TO_JOIN_GAP_MS)
          if (joinTokenRef.current !== token) return
        }
        // Only Warzone lobbies push the exec-hash config cbuf (documented in
        // wz commands.txt). Multiplayer and zombies matches are configured
        // natively by the game's own lobby — NO cbuf, just the LAN join.
        if (modeNeedsConfig(current.gameMode)) {
          const configCommand = getJupiterConfigCommand({ map: current.map, mode: current.mode })
          await writeJupiterCbufCommand(configCommand)
        }
        // Give the game a moment to consume the config before connecting.
        await wait(CBUF_TO_JOIN_GAP_MS)
        if (joinTokenRef.current !== token) return
        await joinJupiterLanSession(current.lanSession)
        if (joinTokenRef.current !== token) return
      }

      // Register as a player in the lobby (host sees us on their dashboard).
      // Dev-server joins skip this entirely — there is no real server row,
      // so nothing is registered (the roster shows a local self-card
      // instead).
      let memberId = null
      let memberCode = null
      if (SUPABASE_CONFIGURED && supabase && !current.isDevServer) {
        try {
          if (user?.id) {
            const { data, error } = await supabase
              .from('server_members')
              .upsert(
                { server_id: current.serverId, user_id: user.id, display_name: getDisplayName(user) },
                { onConflict: 'server_id,user_id' }
              )
              .select('id')
              .single()
            if (!error && data) memberId = data.id
          } else {
            memberCode = makePlayerCode()
            const { data, error } = await supabase
              .from('server_members')
              .insert({ server_id: current.serverId, player_code: memberCode })
              .select('id')
              .single()
            if (!error && data) memberId = data.id
          }
        } catch (memberError) {
          // Non-fatal: the join already went through; the host just won't
          // see us listed.
          console.warn('[session] member registration failed', memberError)
        }
      }

      if (!current.isDevServer) {
        await setLeaderServer(current.serverId)
      }

      // Remember the lobby we joined + our membership in it so the roster
      // HUD keeps polling after the result modal is dismissed.
      lastServerIdRef.current = current.serverId
      lastMemberRef.current = { serverId: current.serverId, memberId, memberCode, isDevServer: current.isDevServer }

      if (joinTokenRef.current !== token) return
      setJoin((prev) => prev ? { ...prev, stage: 'result', memberId, memberCode } : prev)
      setLastLobby({
        name: current.serverName,
        map: current.map,
        mode: current.mode,
        isDevServer: current.isDevServer,
      })
    } catch (error) {
      if (joinTokenRef.current !== token) return
      setJoin(null)
      // The connect failed — no match was reached, so the music comes back.
      restoreModeMusic()
      showError(`COULDN'T JOIN ${current.serverName}`, error?.message || String(error) || 'RTM trigger write failed.')
    }
  }, [getDisplayName, setLeaderServer, showError, user?.id])

  const continueJoin = useCallback(async () => {
    const current = joinRef.current
    if (!current || current.stage !== 'guided') return
    await sendAndJoin()
  }, [sendAndJoin])

  // Retry a failed join from the result modal: re-runs the config + connect
  // (no prep — the game is already in the local lobby).
  const retryJoin = useCallback(async () => {
    const current = joinRef.current
    if (!current || current.stage !== 'result') return
    await sendAndJoin()
  }, [sendAndJoin])

  const leaveMembership = useCallback(async (session) => {
    // Dev-server sessions have no Supabase presence — nothing to clean up.
    if (!session || session.isDevServer) return
    if (!SUPABASE_CONFIGURED || !supabase) return
    try {
      if (session.memberId) {
        const query = supabase.from('server_members').delete().eq('id', session.memberId)
        if (session.memberCode) query.eq('player_code', session.memberCode)
        await query
      }
    } catch (error) {
      console.warn('[session] member leave failed', error)
    }
    try {
      await clearLeaderServer(session.serverId)
    } catch (error) {
      console.warn('[session] leader broadcast clear failed', error)
    }
  }, [clearLeaderServer])

  const finishJoin = useCallback(async () => {
    const session = joinRef.current
    joinTokenRef.current += 1
    setJoin(null)
    if (session) {
      // Don't auto-rejoin the lobby we just left when the leader is still in it.
      lastAutoJoinServerIdRef.current = session.serverId
      await leaveMembership(session)
    }
  }, [leaveMembership])

  // Leave the server we are currently connected to: tell the game to drop
  // the connection (-disconnect) and return to the main menu
  // (-lua MainMenuOffline), then clear every piece of session state (join
  // modal, map badge, roster, membership row so the host's player count
  // drops). The interface caller navigates back to the Play menu.
  const leaveServer = useCallback(async () => {
    const current = joinRef.current
    joinTokenRef.current += 1
    setJoin(null)
    setLastLobby(null)
    lastServerIdRef.current = null
    lastMemberRef.current = null
    setLobbyMembers([])
    // Fire the game commands — failures are logged, never fatal: the launcher
    // UI returns to the menu regardless (the game may need a manual
    // disconnect if the RTM trigger write itself is unavailable).
    try {
      await runRtm(['-disconnect'])
    } catch (error) {
      console.warn('[session] disconnect failed', error)
    }
    try {
      await writeJupiterLuaCommand('MainMenuOffline')
    } catch (error) {
      console.warn('[session] main-menu command failed', error)
    }
    if (current) {
      try {
        await leaveMembership(current)
      } catch (error) {
        console.warn('[session] leave cleanup failed', error)
      }
    }
    // Back in the launcher — bring the soundtrack back up.
    restoreModeMusic()
  }, [leaveMembership])

  const abortJoin = useCallback(() => {
    joinTokenRef.current += 1
    setJoin(null)
    // The join was abandoned — no match was reached, so the music comes back.
    restoreModeMusic()
  }, [])

  // ── Dev-server watcher: settings map/mode changes → client update ──────
  // A dev server has no Supabase row to watch, so its "host" is the Options
  // > Developer settings: while connected to it, editing the map/mode there
  // re-runs the config cbuf exactly like a host change on a real server.
  // Per the dev-server rule this only happens when a LAN session is
  // configured — without one the HUD updates but no map/mode commands run.
  useEffect(() => {
    if (!join?.isDevServer || join?.stage !== 'result') return undefined
    const dev = buildDevServer(settings, join?.gameMode)
    if (!dev) return undefined
    if (dev.map === join.map && dev.mode === join.mode) return undefined

    const hasLanSession = dev.lanSession !== ''
    const apply = () => {
      setJoin((current) => current ? { ...current, map: dev.map, mode: dev.mode } : current)
      // Keep the persisted HUD info in sync too — the badge would otherwise
      // revert to the original map after Finish.
      setLastLobby({ name: dev.name, map: dev.map, mode: dev.mode, isDevServer: true })
    }
    // Same rule as the join flow: only Warzone dev servers push the
    // exec-hash config cbuf — multiplayer/zombies update the HUD only.
    if (hasLanSession && modeNeedsConfig(join?.gameMode)) {
      writeJupiterCbufCommand(getJupiterConfigCommand({ map: dev.map, mode: dev.mode }))
        .then(() => {
          apply()
          pushToast('info', 'LOBBY UPDATED', `Dev server changed to ${dev.map} · ${dev.mode} — your client was updated.`)
        })
        .catch((updateError) => {
          console.warn('[session] dev map change cbuf failed', updateError)
        })
    } else {
      apply()
    }
  }, [join, pushToast, settings])

  // ── Joined-server watcher: host map/mode changes + heartbeat ────────────
  useEffect(() => {
    const session = join
    if (!session?.memberId || !SUPABASE_CONFIGURED || !supabase) return undefined

    let disposed = false
    const interval = window.setInterval(async () => {
      if (disposed) return
      try {
        const { data: server, error } = await supabase
          .from('servers')
          .select('id, map, mode, name')
          .eq('id', session.serverId)
          .single()
        if (error || !server) {
          // Host closed the lobby (or it vanished) — leave the session.
          if (!disposed) {
            pushToast('info', 'SERVER CLOSED', `${session.serverName} was closed by the host.`)
            joinTokenRef.current += 1
            lastAutoJoinServerIdRef.current = session.serverId
            lastServerIdRef.current = null
            lastMemberRef.current = null
            setLobbyMembers([])
            setJoin(null)
            setLastLobby(null)
            void leaveMembership(session)
          }
          return
        }

        // Host changed the map/mode → auto-update our client via a cbuf trigger.
        if ((server.map && server.map !== session.map) || (server.mode && server.mode !== session.mode)) {
          try {
            await writeJupiterCbufCommand(getJupiterConfigCommand({ map: server.map, mode: server.mode }))
            if (!disposed) {
              setJoin((current) => current ? { ...current, map: server.map, mode: server.mode } : current)
              // Keep the persisted HUD info in sync too — otherwise the
              // badge would revert to the original map after Finish.
              setLastLobby({ name: session.serverName, map: server.map, mode: server.mode, isDevServer: session.isDevServer })
              pushToast('info', 'LOBBY UPDATED', `Host changed the lobby to ${server.map} · ${server.mode} — your client was updated.`)
            }
          } catch (updateError) {
            console.warn('[session] map change cbuf failed', updateError)
          }
        }

        // Heartbeat so the host's player list keeps us fresh.
        try {
          if (session.memberCode) {
            await supabase
              .from('server_members')
              .update({ last_seen_at: new Date().toISOString() })
              .eq('server_id', session.serverId)
              .eq('player_code', session.memberCode)
          } else {
            await supabase
              .from('server_members')
              .update({ last_seen_at: new Date().toISOString() })
              .eq('id', session.memberId)
          }
        } catch (heartbeatError) {
          // Non-fatal — the row may already be gone (server closed).
        }
      } catch (watchError) {
        console.warn('[session] server watcher failed', watchError)
      }
    }, SERVER_WATCH_MS)

    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [join, leaveMembership, pushToast])

  // ── Lobby roster (right-side player cards while connected) ──────────────
  // While connected to a server (join result stage, or after the modal is
  // dismissed — lastLobby persists because the player is still in-game),
  // poll server_members so the roster shows EVERYONE in the lobby, not
  // just the party. Party membership marking happens in PlayerRoster (it
  // cross-references partyMembers). Our own card is always injected at the
  // top from lastMemberRef because finishJoin deletes our row on modal
  // dismiss even though we are still connected.
  useEffect(() => {
    const joined = join?.stage === 'result' || Boolean(lastLobby)
    const serverId = lastServerIdRef.current
    // Dev-server sessions never register members — no server_members to
    // poll. Show a local self-card instead so the right-side roster reads
    // "IN LOBBY · you" exactly like a real (solo) lobby.
    if (lastMemberRef.current?.isDevServer) {
      setLobbyMembers([
        {
          userId: user?.id || null,
          name: user?.id ? getDisplayName(user) : 'You',
          region: '',
          isGuest: !user?.id,
          isMe: true,
        },
      ])
      return undefined
    }
    if (!joined || !serverId || !SUPABASE_CONFIGURED || !supabase) {
      setLobbyMembers([])
      return undefined
    }

    let disposed = false
    const refresh = async () => {
      if (disposed) return
      try {
        const { data: rows } = await supabase
          .from('server_members')
          .select('user_id, player_code, display_name')
          .eq('server_id', serverId)
        const list = rows || []

        // Player-join cue: detect NEW members arriving while we're in the
        // lobby (same self-skip logic as the roster build below).
        const me = lastMemberRef.current
        const currentKeys = new Set()
        for (const row of list) {
          if (user?.id && row.user_id === user.id) continue
          if (!user?.id && me && row.player_code === me.memberCode) continue
          currentKeys.add(row.user_id || row.player_code)
        }
        const knownMembers = knownLobbyMembersRef.current
        if (!knownMembers || knownMembers.serverId !== serverId) {
          knownLobbyMembersRef.current = { serverId, keys: currentKeys }
        } else {
          let someoneJoined = false
          for (const key of currentKeys) {
            if (!knownMembers.keys.has(key)) { someoneJoined = true; break }
          }
          if (someoneJoined) playSound('playerJoin')
          knownMembers.keys = currentKeys
        }

        // Resolve display names + regions for signed-in members.
        const signedInIds = list.filter((row) => row.user_id).map((row) => row.user_id)
        const profileMap = {}
        if (signedInIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profile_names')
            .select('user_id, username, display_name, region')
            .in('user_id', signedInIds)
          for (const profile of profiles || []) profileMap[profile.user_id] = profile
        }

        const roster = []
        // Our own card first — even if our server_members row was deleted
        // by finishJoin, we are still in the game.
        if (me && me.serverId === serverId) {
          let meRegion = ''
          if (user?.id) {
            const { data: profile } = await supabase
              .from('profile_names')
              .select('region')
              .eq('user_id', user.id)
              .single()
            meRegion = profile?.region || ''
          }
          roster.push({
            userId: user?.id || null,
            name: user?.id ? getDisplayName(user) : me.memberCode || 'You',
            region: meRegion,
            isGuest: !user?.id,
            isMe: true,
          })
        }

        for (const row of list) {
          // Skip our own row — the injected self card above represents us.
          if (user?.id && row.user_id === user.id) continue
          if (!user?.id && me && row.player_code === me.memberCode) continue
          roster.push({
            userId: row.user_id,
            name: row.user_id
              ? profileMap[row.user_id]?.username || profileMap[row.user_id]?.display_name || row.display_name || 'Unknown'
              : row.player_code || 'Guest',
            region: row.user_id ? profileMap[row.user_id]?.region || '' : '',
            isGuest: !row.user_id,
          })
        }
        setLobbyMembers(roster)
      } catch (rosterError) {
        console.warn('[session] lobby roster refresh failed', rosterError)
      }
    }

    void refresh()
    const interval = window.setInterval(() => void refresh(), SERVER_WATCH_MS)
    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [join?.stage, lastLobby, user?.id])

  // ── Party watcher: leader joins a server → members auto-join ────────────
  useEffect(() => {
    if (!user?.id || !SUPABASE_CONFIGURED || !supabase) return undefined

    let disposed = false
    const interval = window.setInterval(async () => {
      if (disposed) return
      try {
        const party = await getMyParty()
        if (!party || !party.leader_server_id) {
          lastAutoJoinServerIdRef.current = null
          return
        }
        // Already auto-joined this server (or just left it) — wait for the
        // leader to switch to a different lobby before running the flow again.
        if (lastAutoJoinServerIdRef.current === party.leader_server_id) return
        if (joinRef.current) return

        const { data: server } = await supabase
          .from('servers')
          .select('*')
          .eq('id', party.leader_server_id)
          .single()
        if (!server) return

        // Resolve the leader's display name for the modal title.
        let leaderName = 'Your party leader'
        if (party.leader_user_id) {
          const { data: profile } = await supabase
            .from('profile_names')
            .select('username, display_name')
            .eq('user_id', party.leader_user_id)
            .single()
          if (profile) leaderName = profile.username || profile.display_name || leaderName
        }

        pushToast('info', 'PARTY JOIN', `${leaderName} joined ${server.name || 'a lobby'} — preparing your client…`)
        lastAutoJoinServerIdRef.current = party.leader_server_id
        await beginJoin({
          id: server.id,
          name: server.name,
          map: server.map,
          mode: server.mode,
          lanSession: typeof server.lan_session === 'string' ? server.lan_session.trim() : '',
        }, 'party')
      } catch (partyError) {
        console.warn('[session] party watcher failed', partyError)
      }
    }, PARTY_WATCH_MS)

    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [beginJoin, getMyParty, pushToast, user?.id])

  // ── Party invite notifications ───────────────────────────────────────────
  useEffect(() => {
    if (!user?.id || !SUPABASE_CONFIGURED || !supabase) return undefined

    let disposed = false
    const interval = window.setInterval(async () => {
      if (disposed) return
      try {
        const { data: invites } = await supabase
          .from('party_invites')
          .select('id, party_id, invited_by_user_id, created_at')
          .eq('invitee_user_id', user.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
        if (!invites || invites.length === 0) return

        for (const invite of invites) {
          if (knownInviteIdsRef.current.has(String(invite.id))) continue
          knownInviteIdsRef.current.add(String(invite.id))

          let inviterName = 'A friend'
          if (invite.invited_by_user_id) {
            const { data: profile } = await supabase
              .from('profile_names')
              .select('username, display_name')
              .eq('user_id', invite.invited_by_user_id)
              .single()
            if (profile) inviterName = profile.username || profile.display_name || inviterName
          }

          pushToast('party-invite', 'PARTY INVITE', `${inviterName} invited you to their party.`, {
            accept: async () => {
              // Leaving any existing party first keeps the auto-join single-source.
              await supabase.from('party_members').delete().eq('user_id', user.id)
              await supabase.from('party_members').insert({ party_id: invite.party_id, user_id: user.id })
              await supabase.from('party_invites').update({ status: 'accepted' }).eq('id', invite.id)
              pushToast('info', 'PARTY JOINED', 'You are now in the party. When the leader joins a lobby, your client follows automatically.')
            },
            decline: async () => {
              await supabase.from('party_invites').update({ status: 'declined' }).eq('id', invite.id)
            },
          })
        }
      } catch (inviteError) {
        console.warn('[session] invite watcher failed', inviteError)
      }
    }, INVITE_WATCH_MS)

    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [pushToast, user?.id])

  // Clean up a lingering membership if the provider unmounts (mod switch).
  useEffect(() => {
    return () => {
      const session = joinRef.current
      joinTokenRef.current += 1
      if (session?.memberId) {
        void leaveMembership(session)
      }
    }
  }, [leaveMembership])

  // "In a server": the join succeeded (result stage) or we are still
  // connected after dismissing the result modal (lastLobby persists — the
  // player is still in-game). Drives the connected UI: the Play menu's
  // connected panel, the Leave Server button, and the map badge.
  const currentLobby = join?.stage === 'result'
    ? { name: join.serverName, map: join.map, mode: join.mode, isDevServer: join.isDevServer }
    : (lastLobby || null)
  const connected = Boolean(currentLobby)

  return (
    <SessionContext.Provider
      value={{
        join,
        connected,
        currentLobby,
        beginJoin,
        continueJoin,
        retryJoin,
        finishJoin,
        abortJoin,
        leaveServer,
        pushToast,
        showError,
        partyMembers,
        lobbyMembers,
        // Host-a-Match integration: the party leader's host flow broadcasts
        // the new lobby (members auto-join via the party watcher) and clears
        // it when the lobby closes.
        broadcastLeaderServer: setLeaderServer,
        clearLeaderServer,
      }}
    >
      {children}

      <JupiterJoinModal
        theme={theme}
        stage={join?.stage || null}
        serverName={join?.serverName}
        mode={join?.gameMode || 'warzone'}
        onContinue={continueJoin}
        onFinish={() => void finishJoin()}
        onRetry={() => void retryJoin()}
        onCancel={cancelJoin}
      />
      <JupiterErrorModal
        theme={theme}
        isOpen={Boolean(errorModal)}
        title={errorModal?.title}
        message={errorModal?.message}
        onClose={() => setErrorModal(null)}
      />
      {/* No floating CURRENT MAP HUD here anymore: while connected the
          in-game panel (ConnectedServerPanel) renders the current-map
          section in its roster column — the old bottom-right floating
          badge was redundant and got removed. The map/mode still updates
          live via `join` / `lastLobby`. */}

      {toasts.length > 0 && (
        <div className={`jupiter-session-toasts `} role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`jupiter-session-toast jupiter-session-toast-${toast.kind}`}>
              <div className="jupiter-session-toast-title">{toast.title}</div>
              <div className="jupiter-session-toast-message">{toast.message}</div>
              {toast.actions ? (
                <>
                  <div className="jupiter-session-toast-actions">
                    <button
                      type="button"
                      onMouseEnter={() => playSound(hoverSound)}
                      onClick={() => {
                        playSound(selectSound)
                        void toast.actions.accept()
                        dismissToast(toast.id)
                      }}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onMouseEnter={() => playSound(hoverSound)}
                      onClick={() => {
                        playSound(selectSound)
                        void toast.actions.decline()
                        dismissToast(toast.id)
                      }}
                    >
                      Decline
                    </button>
                  </div>
                  <button
                    type="button"
                    className="jupiter-session-toast-dismiss"
                    aria-label="Dismiss invite for now"
                    onClick={() => dismissToast(toast.id)}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="jupiter-session-toast-dismiss"
                  aria-label="Dismiss"
                  onClick={() => dismissToast(toast.id)}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </SessionContext.Provider>
  )
}
