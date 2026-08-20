import { invoke } from '@tauri-apps/api/core'
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase'

export const isTauriRuntime = () => Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__)

export async function loadUserIdentity() {
  if (!isTauriRuntime()) return null
  return invoke('load_user_identity')
}

export async function saveUserIdentity(identity) {
  if (!isTauriRuntime()) return
  await invoke('save_user_identity', { identity })
}

export async function clearUserIdentity() {
  if (!isTauriRuntime()) return
  await invoke('clear_user_identity')
}

/**
 * Ask a security-definer Supabase function whether this identity is linked to
 * a banned account. The function checks the current account itself, every
 * account sharing the Discord username, and every account sharing the email.
 * Gamertag is intentionally not used as a cross-account match.
 */
export async function checkIdentityBan(identity) {
  if (!SUPABASE_CONFIGURED || !supabase) {
    throw new Error('The backend is not configured, so the account ban check cannot run.')
  }

  const { data, error } = await supabase.rpc('check_identity_ban', {
    p_discord_username: identity.discord_username,
    p_email: identity.email,
    p_gamertag: identity.gamertag,
  })

  if (error) throw error
  return data === true
}
