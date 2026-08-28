import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase'

// ──────────────────────────────────────────────────────────────────────────────
// AuthProvider — email + password only.
//
// Exposes via useAuth():
//   session        – raw Supabase session (or null)
//   user           – shortcut for session?.user ?? null
//   loading        – true until the initial session check completes
//   configured     – true when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set
//   error          – last auth error (cleared on each new attempt)
//   signUp         – (email, password, gamertag, discordUsername) → creates an account
//   signIn         – (email, password) → signs in
//   signOut        – signs out
// ──────────────────────────────────────────────────────────────────────────────

const AuthContext = createContext({
  session: null,
  user: null,
  loading: true,
  configured: false,
  error: null,
  signUp: async () => {},
  signIn: async () => {},
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

export default function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED)
  const [error, setError] = useState(null)

  // ── 1) Initial session fetch + auth-state subscription ────────────────────
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) {
      setLoading(false)
      return
    }

    let mounted = true

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return
        setSession(data.session ?? null)
        setLoading(false)
      })
      .catch((err) => {
        if (!mounted) return
        setError(err)
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  // ── 2) Sign up — email + password + gamertag ─────────────────────────────
  //    // gamertag is shipped via options.data so Supabase stores it in
    // raw_user_meta_data under BOTH keys: `gamertag` (read by the
    // frontend's getDisplayName chain) and `username` (read by the
    // handle_new_user DB trigger that populates public.profiles.username,
    // which is what friend search matches against).
  //
  // After signUp, Supabase may require email confirmation depending on
  // the project's Auth settings.  If email confirmation is ON the user
  // won't get a session until they click the link — that's expected
  // and the UI should tell them to check their inbox.
  const signUp = useCallback(async (email, password, gamertag, discordUsername) => {
    if (!SUPABASE_CONFIGURED) throw new Error('Backend not configured.')
    setError(null)

    const trimmedGamertag = typeof gamertag === 'string' ? gamertag.trim() : ''
    const trimmedDiscordUsername = typeof discordUsername === 'string' ? discordUsername.trim() : ''
    if (!trimmedDiscordUsername) throw new Error('A complete Discord username is required.')

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          gamertag: trimmedGamertag,
          username: trimmedGamertag,
          discord_username: trimmedDiscordUsername,
        },
      },
    })

    if (signUpError) {
      setError(signUpError)
      throw signUpError
    }

    // If the project has email confirmation OFF, Supabase returns a
    // session immediately.  If it's ON, data.session will be null and
    // the user needs to confirm via email — we still consider that a
    // success and let the AccountTab show the "check your inbox" state.
    if (data.session) {
      setSession(data.session)
    }

    return data
  }, [])

  // ── 3) Sign in — email + password ────────────────────────────────────────
  const signIn = useCallback(async (email, password) => {
    if (!SUPABASE_CONFIGURED) throw new Error('Backend not configured.')
    setError(null)

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(signInError)
      throw signInError
    }

    setSession(data.session)
    return data
  }, [])

  // ── 4) Sign out ──────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    if (!SUPABASE_CONFIGURED) return
    setError(null)
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) {
      setError(signOutError)
      throw signOutError
    }
    setSession(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        configured: SUPABASE_CONFIGURED,
        error,
        signUp,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
