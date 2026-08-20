import { invoke } from '@tauri-apps/api/core'
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase'

// One random id per app launch. Every hosted server row records it, so a
// fresh process can distinguish its lobbies from an older process.
export const appInstanceId = (() => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch { /* fall through */ }
  return `inst-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
})()

// The database cleanup job removes a lobby after this much time without a
// host heartbeat. Keep the client interval comfortably below that threshold.
export const SERVER_HEARTBEAT_MS = 15_000
export const SERVER_STALE_AFTER_MS = 45_000

export function isServerLeaseFresh(server) {
  if (!server?.last_heartbeat_at) return false
  const heartbeat = Date.parse(server.last_heartbeat_at)
  return Number.isFinite(heartbeat) && Date.now() - heartbeat <= SERVER_STALE_AFTER_MS
}

// Keep ownership in module memory rather than localStorage/sessionStorage: a
// fresh app process must never use an old process's ownership registry.
// Values include the owner because Supabase RLS requires it for deletes and
// updates.
const ownedServerIds = new Map()
let heartbeatTimer = null

function stopHeartbeatTimerIfIdle() {
  if (ownedServerIds.size === 0 && heartbeatTimer !== null) {
    window.clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function ensureHeartbeatTimer() {
  if (heartbeatTimer !== null || !SUPABASE_CONFIGURED || !supabase) return
  heartbeatTimer = window.setInterval(() => {
    void heartbeatOwnedServers()
  }, SERVER_HEARTBEAT_MS)
}

export function registerOwnedServer(serverId, userId) {
  if (!serverId || !userId) return
  ownedServerIds.set(String(serverId), { userId })
  ensureHeartbeatTimer()
  // Write immediately so a newly-created lobby has a fresh lease even if the
  // first interval tick is delayed while the UI is transitioning screens.
  void heartbeatOwnedServers()
}

export function unregisterOwnedServer(serverId) {
  if (serverId) ownedServerIds.delete(String(serverId))
  stopHeartbeatTimerIfIdle()
}

/** Refresh the lease for every lobby owned by this app process. */
export async function heartbeatOwnedServers() {
  if (!SUPABASE_CONFIGURED || !supabase || ownedServerIds.size === 0) return

  const heartbeat = new Date().toISOString()
  await Promise.all([...ownedServerIds.entries()].map(async ([serverId, { userId }]) => {
    try {
      const { error } = await supabase
        .from('servers')
        .update({ last_heartbeat_at: heartbeat })
        .eq('id', serverId)
        .eq('host_user_id', userId)
        .eq('instance_id', appInstanceId)
      if (error) throw error
    } catch (error) {
      // A transient failure is safe: the next tick retries, and the database
      // lease intentionally expires if the app cannot keep renewing it.
      console.warn('[servers] host heartbeat failed', error)
    }
  }))
}

/**
 * Delete every lobby this process registered, plus any lobby belonging to
 * this user and this app instance that was re-attached after navigation.
 * The operation is idempotent and is used by both the quit handler and the
 * custom window close control.
 */
export async function deleteOwnedServers(userId) {
  if (!userId || !SUPABASE_CONFIGURED || !supabase) return

  const ids = [...ownedServerIds.entries()]
    .filter(([, owner]) => owner.userId === userId)
    .map(([serverId]) => serverId)
  const errors = []

  if (ids.length > 0) {
    const { error } = await supabase
      .from('servers')
      .delete()
      .in('id', ids)
      .eq('host_user_id', userId)
    if (error) errors.push(error)
  }

  // Covers a lobby that was re-attached by HostMatch without being registered
  // again, and makes graceful cleanup independent of component mount state.
  const { error: instanceError } = await supabase
    .from('servers')
    .delete()
    .eq('host_user_id', userId)
    .eq('instance_id', appInstanceId)
  if (instanceError) errors.push(instanceError)

  if (errors.length > 0) throw errors[0]

  for (const id of ids) ownedServerIds.delete(id)
  stopHeartbeatTimerIfIdle()
}

/**
 * Fully quit the app. Runs the Rust `exit_app` command (a clean
 * process-wide `app.exit(0)`) — NOT `window.destroy()`, which the capability
 * ACL blocks and which can leave a white window on Windows WebView2.
 */
export async function exitApp() {
  if (window.__TAURI_INTERNALS__) {
    try {
      await invoke('exit_app')
    } catch (error) {
      console.warn('[quit] exit_app failed; falling back to window.close()', error)
      try { window.close() } catch { /* nothing more we can do */ }
    }
  } else {
    window.close()
  }
}

/** Delete signed-in membership rows when the launcher closes. */
export async function deleteMyServerMemberships(userId) {
  if (!userId || !SUPABASE_CONFIGURED || !supabase) return
  const { error } = await supabase.from('server_members').delete().eq('user_id', userId)
  if (error) console.warn('[servers] member cleanup failed', error)
}

/**
 * Session cleanup for parties. Parties are deliberately session-scoped:
 * leader parties are dissolved and memberships in other parties are removed.
 */
export async function cleanupStalePartyMemberships(userId) {
  if (!userId || !SUPABASE_CONFIGURED || !supabase) return

  try {
    const { error } = await supabase
      .from('parties')
      .delete()
      .eq('leader_user_id', userId)
    if (error) console.warn('[parties] leader party cleanup failed', error)
  } catch (error) {
    console.warn('[parties] leader party cleanup failed', error)
  }

  try {
    const { error } = await supabase
      .from('party_members')
      .delete()
      .eq('user_id', userId)
    if (error) console.warn('[parties] member cleanup failed', error)
  } catch (error) {
    console.warn('[parties] member cleanup failed', error)
  }
}

/**
 * Startup sweep for lobbies whose lease expired before this process started.
 * It catches both force-killed processes and legacy rows with no heartbeat.
 * The database Cron job is the authoritative cross-user failsafe; this sweep
 * is an immediate cleanup for this user's old rows.
 */
export async function cleanupStaleOwnedServers(userId) {
  if (!userId || !SUPABASE_CONFIGURED || !supabase) return

  const cutoff = new Date(Date.now() - SERVER_STALE_AFTER_MS).toISOString()
  try {
    const staleQueries = [
      supabase
        .from('servers')
        .delete()
        .eq('host_user_id', userId)
        .lt('last_heartbeat_at', cutoff),
      supabase
        .from('servers')
        .delete()
        .eq('host_user_id', userId)
        .is('last_heartbeat_at', null),
    ]
    const results = await Promise.all(staleQueries)
    for (const { error } of results) {
      if (error) console.warn('[servers] stale cleanup failed', error)
    }
  } catch (error) {
    console.warn('[servers] stale cleanup failed', error)
  }

  await deleteMyServerMemberships(userId)
}

export async function destroyAppWithServerCleanup(userId) {
  try {
    await deleteOwnedServers(userId)
  } catch (error) {
    // Closing must continue even when Supabase is temporarily unavailable;
    // the lease/Cron failsafe will remove the lobby later.
    console.warn('[servers] quit cleanup failed', error)
  }
  await deleteMyServerMemberships(userId)
  await exitApp()
}
