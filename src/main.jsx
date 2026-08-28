import React, { StrictMode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Launcher from './components/Launcher'
import SecurityGateScreen from './components/SecurityGateScreen'
import UpdateModal from './components/UpdateModal'
import JupiterInterface from './components/JupiterInterface'
import JupiterQuitModal from './components/JupiterQuitModal'
import WindowControls from './components/WindowControls'
import { checkForUpdates } from './utils/updater'
import AuthProvider from './components/AuthProvider'
import SettingsProvider, { useSettings } from './components/SettingsProvider'
import './styles.css'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useAuth } from './components/AuthProvider'
import { cleanupStaleOwnedServers, cleanupStalePartyMemberships, destroyAppWithServerCleanup, exitApp } from './utils/serverPresence'
import { checkIdentityBan, isTauriRuntime, loadUserIdentity } from './utils/userIdentity'
import { runRtm } from './utils/jupiterRtm'

const DESIGN_WIDTH = 2560
const DESIGN_HEIGHT = 1440

function UiCanvas({ children }) {
  const viewportRef = useRef(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined

    const updateScale = () => {
      const width = viewport.clientWidth
      const height = viewport.clientHeight
      if (!width || !height) return
      setScale(Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT))
    }

    updateScale()
    const observer = new ResizeObserver(updateScale)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={viewportRef} className="ui-canvas-viewport">
      <div
        className="ui-canvas"
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        <div id="ui-portal-root" className="ui-portal-root" />
        {children}
      </div>
    </div>
  )
}

// Render the game interface after a mode is chosen on the launcher.
function ModStage({ isEntering, isLeaving, onGoLauncher, gameMode }) {
  const { settings, loaded } = useSettings()
  // Wait for the startup settings read (a few ms file read) so the correct
  // shell renders from the first frame of the launch transition.
  if (!loaded || !settings) return null

  return (
    <JupiterInterface
      isEntering={isEntering}
      isLeaving={isLeaving}
      onGoLauncher={onGoLauncher}
      gameMode={gameMode}
    />
  )
}

function App() {
  const { user, loading: authLoading, configured } = useAuth()
  const [securityState, setSecurityState] = useState(() => (
    isTauriRuntime() ? { kind: 'checking' } : { kind: 'ready' }
  ))
  const securityAttemptRef = useRef(0)

  // Desktop builds fail closed before rendering the launcher. Browser mode is
  // intentionally left as a UI-testing environment because it cannot access
  // the requested local device identity file path.
  const runSecurityCheck = useCallback(async () => {
    if (!isTauriRuntime()) {
      setSecurityState({ kind: 'ready' })
      return
    }
    if (authLoading) return

    const attempt = ++securityAttemptRef.current
    setSecurityState({ kind: 'checking' })
    try {
      const identity = await loadUserIdentity()
      if (attempt !== securityAttemptRef.current) return
      console.info('[security] device identity', identity ? 'found' : 'MISSING', identity || '')

      // The local identity file is the DEVICE identity. It is
      // checked against the ban records BEFORE the sign-in screen is ever
      // shown: a banned device is blocked no matter which account the user
      // would sign in with, so wiping the app's session storage (AppData)
      // cannot dodge the ban by re-signing in under a different account
      // (sign-in would only ever overwrite the identity file AFTER this
      // check passes). A backend that can't answer fails closed into
      // 'unavailable'.
      if (identity) {
        if (!configured) {
          console.warn('[security] backend not configured — failing closed')
          setSecurityState({ kind: 'unavailable' })
          return
        }
        const banned = await checkIdentityBan(identity)
        if (attempt !== securityAttemptRef.current) return
        if (banned) {
          console.warn('[security] DEVICE IDENTITY IS BANNED — blocking before sign-in')
          setSecurityState({ kind: 'banned' })
          return
        }
        console.info('[security] device identity verified clean')
      }

      if (!identity) {
        console.info('[security] no identity file — showing account setup (new tester)')
        setSecurityState({ kind: 'setup', reason: 'missing-identity' })
        return
      }
      if (!user?.id) {
        console.info('[security] device clean but not signed in — showing sign-in')
        setSecurityState({ kind: 'setup', reason: 'sign-in-required' })
        return
      }
      if (!configured) {
        setSecurityState({ kind: 'unavailable' })
        return
      }

      // Identity exists, is clean, and the account is signed in — the ban
      // check ran above on the SAME file AccountTab would have written, so
      // no second lookup is needed.
      console.info('[security] device + account verified — launching')
      setSecurityState({ kind: 'ready' })
    } catch (error) {
      if (attempt !== securityAttemptRef.current) return
      console.warn('[security] identity check failed', error)
      setSecurityState({ kind: 'unavailable' })
    }
  }, [authLoading, configured, user?.id])

  useEffect(() => {
    void runSecurityCheck()
  }, [runSecurityCheck])

  // Once the security gate passes, ask the configured update endpoint whether
  // a newer version exists. If one does, UpdateModal pops over the launcher.
  // Failures (offline, unconfigured placeholder endpoint) resolve silently —
  // startup is never blocked by the updater.
  useEffect(() => {
    if (securityState.kind !== 'ready') return undefined
    let active = true
    checkForUpdates().then((update) => {
      if (active && update) setUpdateInfo(update)
    })
    return () => { active = false }
  }, [securityState.kind])

  // Auto-update: the Update object from the startup GitHub-release check
  // (null = none available). See the README's "Auto-update" section for
  // the release/signing setup.
  const [updateInfo, setUpdateInfo] = useState(null)

  const [currentView, setCurrentView] = useState('launcher') // 'launcher' | 'game'
  // Drives the .is-entering class on the ModStage and the .is-expanding
  // class on the Launcher so .css keyframe animations fire.
  //
  //   t=0 ms : user clicks a mode button → setLaunchingInto(mode)
  //   t=480  : launcher unmounts (currentView flips), ModStage mounts with
  //            .is-entering → UI elements start animating in
  //   t=1100 : setLaunchingInto(null) clears the classes so steady state
  //            re-renders are animation-free.
  const [launchingInto, setLaunchingInto] = useState(null)
  const [gameMode, setGameMode] = useState('multiplayer') // 'multiplayer' | 'warzone' | 'zombies'

  // The reverse signal for the Return Home button. While set, the
  // .is-leaving class drives the ModStage UI exit animations and the
  //    .is-collapsing class drives the Launcher collapse. The
  //    timeline mirrors `beginLaunch`:
  //
  //   t=0 ms : user clicks Return Home → setReturningHome(currentView).
  //            Modal already closed in the click handler; the ModStage is
  //            still mounted because currentView !== 'launcher' yet, and
  //            its .is-leaving class drives each UI element out via its
  //            corresponding exit keyframe (header slides up, body fades,
  //            menu/cards slide down, quit slides down).
  //   t=620  : setCurrentView('launcher'). ModStage unmounts. Launcher
  //            mounts with .is-collapsing — the transition settles back
  //            into the steady launcher layout.
  //   t=1100 : setReturningHome(null) clears the class so steady state
  //            re-renders are animation-free.
  const [returningHome, setReturningHome] = useState(null)
  // The shared "Quit to Desktop?" confirmation. Opened by the launcher's
  // quit button AND the window's X (the Tauri close-request handler below
  // just opens this modal — the actual cleanup + exit only runs when the
  // user confirms).
  const [quitModalOpen, setQuitModalOpen] = useState(false)

  const timersRef = useRef([])

  // Username syncing: once the session is known on launch, write the
  // `rename` trigger file with the gamertag so the game knows what username
  // to set for the player. Desktop only — plain-browser dev has no RTM
  // trigger folder.
  useEffect(() => {
    if (!user?.id || !isTauriRuntime()) return undefined
    const gamertag = typeof user.user_metadata?.gamertag === 'string'
      ? user.user_metadata.gamertag.trim()
      : ''
    if (!gamertag) return undefined
    let active = true
    runRtm(['-rename', gamertag]).catch((error) => {
      if (active) console.warn('[username] could not write the rename file', error)
    })
    return () => { active = false }
  }, [user?.id, user?.user_metadata])

  // On launch, once the session is known: remove anything this user left
  // behind in a previous session — lobbies from an earlier app process
  // (force-kill / crash case — the graceful close handler below covers
  // normal quits), stale lobby memberships, and party memberships (parties
  // do NOT transfer between sessions). Runs on every launch, desktop AND
  // browser: in plain-browser dev a page load IS a launch, so closing the
  // tab and coming back must not resurrect last session's squad.
  useEffect(() => {
    if (!user?.id) return undefined
    void cleanupStaleOwnedServers(user.id)
    void cleanupStalePartyMemberships(user.id)
    return undefined
  }, [user?.id])

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return undefined

    let active = true
    let unlisten

    // The window's X (and any OS close request) opens the quit
    // confirmation instead of exiting — the cleanup + `exit_app` sequence
    // runs only when the user confirms the modal (see handleQuitDesktop
    // below). `exitApp()` intentionally bypasses this close-request event,
    // so a confirmed quit never re-opens the modal.
    const handleCloseRequested = (event) => {
      event.preventDefault()
      setQuitModalOpen(true)
    }

    getCurrentWindow().onCloseRequested(handleCloseRequested)
      .then((removeListener) => {
        if (active) {
          unlisten = removeListener
        } else {
          // React StrictMode can unmount before the async listener
          // registration resolves. Remove late listeners immediately so a
          // stale handler cannot prevent a future close.
          removeListener()
        }
      })
      .catch((error) => {
        if (active) console.warn('[servers] could not register close cleanup', error)
      })

    return () => {
      active = false
      unlisten?.()
    }
  }, [])

  // Confirmed quit (quit modal on the launcher or via the window X):
  // remove anything this session left on the backend — lobbies, lobby
  // memberships, and parties (parties are session-scoped) — then exit.
  // `destroyAppWithServerCleanup` ends with `exit_app` (a clean
  // `app.exit(0)` on the Rust side) which terminates the whole process and
  // intentionally bypasses the close-request handler, so there is no
  // recursion. The old `window.destroy()` was blocked by the capability
  // ACL and could leave a white window on Windows.
  const handleQuitDesktop = async () => {
    setQuitModalOpen(false)
    if (user?.id) {
      try {
        await cleanupStalePartyMemberships(user.id)
      } catch (error) {
        console.warn('[servers] quit party cleanup failed', error)
      }
    }
    try {
      await destroyAppWithServerCleanup(user?.id)
    } catch (error) {
      console.warn('[quit] cleanup failed; forcing exit', error)
      await exitApp()
    }
  }

  if (securityState.kind !== 'ready') {
    return (
      <div className="app-root">
        <UiCanvas>
          <SecurityGateScreen state={securityState} onRetry={runSecurityCheck} />
        </UiCanvas>
        <WindowControls />
      </div>
    )
  }

  const clearTimers = () => {
    for (const id of timersRef.current) window.clearTimeout(id)
    timersRef.current = []
  }

  const handleGoLauncher = () => {
    setCurrentView('launcher')
    setLaunchingInto(null)
    setReturningHome(null)
    clearTimers()
  }

  const beginLaunch = (mode) => {
    if (launchingInto || returningHome) return // ignore double-clicks while a transition is in flight
    setLaunchingInto('game')
    if (mode) setGameMode(mode)
    clearTimers()
    // T = ~480 ms: the launcher's mode button has finished its press
    // animation. Swap currentView so the Launcher unmounts cleanly and the
    // ModStage replaces it — the ModStage's .jupiter-interface-container
    // paints the same background at the same cover-fit scale on the same
    // full-viewport surface, so the cutover is pixel-identical (no visible
    // snap).
    timersRef.current.push(
      window.setTimeout(() => {
        setCurrentView('game')
      }, 480)
    )
    // T = ~1100 ms: every entrance animation in the ModStage has settled
    // (`fill-mode: both` keeps the element at the to-state). Drop the
    // launching state so we stop driving CSS animations on every
    // subsequent re-render.
    timersRef.current.push(
      window.setTimeout(() => {
        setLaunchingInto(null)
      }, 1100)
    )
  }

  const beginReturnHome = () => {
    if (returningHome || launchingInto) return
    if (currentView === 'launcher') return
    setReturningHome('game')
    clearTimers()
    // T = ~620 ms: UI exit animations on the ModStage have settled. Swap
    // currentView so the ModStage unmounts (the launcher takes its place).
    // The Launcher mounts fresh with its .is-collapsing class which
    // animates the launcher layout back to its steady state.
    timersRef.current.push(
      window.setTimeout(() => {
        setCurrentView('launcher')
      }, 620)
    )
    // T = ~1100 ms: tile collapse has settled. Drop the returning state
    // so steady state re-renders don't keep paying the cost of the
    // .is-collapsing-{mod}-driven CSS animations.
    timersRef.current.push(
      window.setTimeout(() => {
        setReturningHome(null)
      }, 1100)
    )
  }

  return (
    <div className="app-root">
      <UiCanvas>
        {currentView === 'launcher' && (
          <Launcher
            onSelectMod={beginLaunch}
            expandingMod={launchingInto}
            collapsingMod={returningHome}
            navDisabled={Boolean(updateInfo) || quitModalOpen}
            onQuitClick={() => setQuitModalOpen(true)}
          />
        )}

        {currentView !== 'launcher' && (
          <div
            key={`${currentView}-mod-stage`}
            className={`mod-stage ${launchingInto ? 'is-entering' : ''} ${returningHome ? 'is-leaving' : ''}`}
          >
            <ModStage
              isEntering={!!launchingInto}
              isLeaving={!!returningHome}
              onGoLauncher={beginReturnHome}
              gameMode={gameMode}
            />
          </div>
        )}

        {/* Shared "Quit to Desktop?" confirmation — opened by the launcher's
            quit button and the window's X (from any view). On the launcher
            there is no "Return to Launcher Menu" action to offer. */}
        <JupiterQuitModal
          isOpen={quitModalOpen}
          showReturnToLauncher={currentView !== 'launcher'}
          onClose={() => setQuitModalOpen(false)}
          onGoLauncher={() => {
            setQuitModalOpen(false)
            beginReturnHome()
          }}
          onQuitDesktop={() => void handleQuitDesktop()}
        />
      </UiCanvas>
      <WindowControls />
      {/* Zombies mode rough accent bar clip path */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <clipPath id="zombiesBarClip" clipPathUnits="objectBoundingBox">
            <path d="M 0 0 L 1 0 L 1 0.7 C 0.94 0.62, 0.88 0.78, 0.81 0.65 C 0.74 0.76, 0.67 0.58, 0.6 0.72 C 0.53 0.82, 0.46 0.64, 0.39 0.76 C 0.32 0.84, 0.25 0.68, 0.18 0.78 C 0.11 0.7, 0.05 0.82, 0 0.72 Z" />
          </clipPath>
        </defs>
      </svg>
      {/* Startup auto-update dialog — shown when the GitHub release check
          finds a newer version (Update Now / Later). Theme-neutral: it sits
          over the launcher before a mod is chosen. */}
      <UpdateModal update={updateInfo} onDismiss={() => setUpdateInfo(null)} />
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/*
      AuthProvider wraps the whole app so any descendant component can call
      `useAuth()` to read the current session or kick off a Supabase OAuth
      flow. Supabase + the deep-link plugin listener only do meaningful work
      when .env has VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY populated;
      otherwise the provider just reports `configured: false` and stays out
      of the way.
    */}
    <AuthProvider>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </AuthProvider>
  </StrictMode>
)
