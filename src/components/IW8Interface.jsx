import React, { useCallback, useEffect, useRef, useState } from 'react'
import IW8QuitModal from './IW8QuitModal'
import SocialTab from './SocialTab'
import AccountTab from './AccountTab'
import PlayerRoster from './PlayerRoster'
import HelpTab from './HelpTab'
import OptionsTab from './OptionsTab'
import ModdingTab from './ModdingTab'
import ServerBrowser from './ServerBrowser'
import HostMatch from './HostMatch'
import ConnectedServerPanel from './ConnectedServerPanel'
import LeaveServerConfirmModal from './LeaveServerConfirmModal'
import IW8JoinModal from './IW8JoinModal'
import AuthRequiredNotice from './AuthRequiredNotice'
import { useAuth } from './AuthProvider'
import { useSettings } from './SettingsProvider'
import { getDisplayName } from '../utils/displayName'
import { buildDevServer } from '../utils/devServer'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { useGlyphPlatform, glyphSrc } from '../utils/glyphs'
import { destroyAppWithServerCleanup, isServerLeaseFresh } from '../utils/serverPresence'
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase'
import JupiterSessionProvider, { useJupiterSession } from '../utils/jupiterSession'
import JupiterQuickPlayModal from './JupiterQuickPlayModal'
import iw8Logo from '../assets/iw8_logo.png'
import jupLogo from '../assets/jup_logo.png'
import TutorialOverlay, { hasTutorialBeenSeen, markTutorialSeen } from './TutorialOverlay'
import { useTranslation } from '../utils/i18n'

// `mod` is the CONTENT mod the shell renders. Normally it matches the shell
// (IW8 shell + IW8 content), but Options > Dynamic Interfaces can swap the
// shell independently (e.g. Jupiter content inside the IW8 shell — the
// Modding tab and the full RTM join flow then run with IW8 styling).
export default function IW8Interface({ mod = 'iw8', ...props }) {
  if (mod === 'jupiter') {
    // Jupiter content needs the session provider for the join flow, the
    // join modal and the party watchers — same provider Jupiter uses, but
    // dressed in the IW8 shell's styling.
    return (
      <JupiterSessionProvider theme="iw8">
        <IW8InterfaceContent {...props} mod={mod} />
      </JupiterSessionProvider>
    )
  }
  return <IW8InterfaceContent {...props} mod={mod} />
}

function IW8InterfaceContent({ mod = 'iw8', onSwitchMod, onGoLauncher, isEntering = false, isLeaving = false }) {
  const session = useJupiterSession() // null without a provider (IW8 content)
  const isJupiterContent = mod === 'jupiter'
  const { user } = useAuth()
  const { glyphPlatform } = useGlyphPlatform()
  const { t } = useTranslation()
  const displayName = user ? getDisplayName(user) : ''
  // Six tabs when Jupiter content (RTM tab is Jupiter-specific UI), five
  // without. Discord merged into Help (one "Help" tab now lists the mod's
  // community servers + support cards):
  // Play | RTM | Account | Social | Help | Options
  const tabs = isJupiterContent
    ? ['Play', 'RTM', 'Account', 'Social', 'Help', 'Options']
    : ['Play', 'Account', 'Social', 'Help', 'Options']
  const playItems = ['Quick Play', 'Server Browser', 'Host a Match']

  const [activeHeaderTab, setActiveHeaderTab] = useState('Play')
  const [isQuitModalOpen, setIsQuitModalOpen] = useState(false)
  // Leave-server confirmation: Esc on the in-game screen or the Leave
  // Server button opens it — leaving disconnects and returns to the menu,
  // so it's worth an explicit confirm (same quiet-down gating).
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [suppressedMenuItem, setSuppressedMenuItem] = useState(null)
  const [inputMode, setInputMode] = useState('mouse')
  // Tutorial: shown once per user after first sign-in in this interface.
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const tutorialShownRef = useRef(false)
  const [playView, setPlayView] = useState('menu')
  // True while the Modding tab's error modal is open — its own controller
  // hook handles the keys, so the interface hook must go quiet (mirrors the
  // `!session?.join` gating).
  const [moddingErrorOpen, setModdingErrorOpen] = useState(false)
  // True while the Options tab's interface-reload confirmation is open —
  // same quiet-down reasoning as moddingErrorOpen.
  const [interfaceModalOpen, setInterfaceModalOpen] = useState(false)
  // IW8 join flow: no RTM automation — just show the console command with
  // a copy button, then transition to a simple in-server screen.
  const [iw8JoinServer, setIw8JoinServer] = useState(null) // server being joined (modal open)
  const [iw8Connected, setIw8Connected] = useState(null) // server currently connected to (in-server screen)

  // While connected to a server (join result / still in-game after the
  // modal), the play menu collapses to the connected panel's single Leave
  // Server button — the index math shrinks the menu to one slot so
  // controller focus never lands on a hidden item.
  const inServer = Boolean(session?.connected) || Boolean(iw8Connected)
  const currentLobby = session?.currentLobby || null
  const menuCount = inServer ? 1 : playItems.length
  const firstMenuIdx = tabs.length
  const lastMenuIdx = tabs.length + menuCount - 1
  const quitIdx = tabs.length + menuCount

  // IW8 Quick Play: polls for a joinable IW8 lobby (mod === 'iw8' + valid
  // lan_session) for up to 60 s. Found → opens the IW8 join modal.
  // Not found → no-match modal with Search Again / Cancel.
  const IW8_QP_SEARCH_S = 60
  const IW8_QP_POLL_STEP_S = 5
  const IW8_QP_MIN_SEARCH_MS = 800
  const [quickPlay, setQuickPlay] = useState(null) // null | { phase: 'searching', remaining } | { phase: 'found', server, countdown }
  const [noMatchModal, setNoMatchModal] = useState(null)
  const qpBusyRef = useRef(false)
  const qpTokenRef = useRef(0)
  const qpTimerRef = useRef(null)
  const qpSearchStartRef = useRef(0)
  const { settings } = useSettings()

  const handleMouseMove = (event) => {
    if (event.movementX !== 0 || event.movementY !== 0) setInputMode('mouse')
  }

  const handleHover = () => playSound('iw8Hover')

  // Open the tutorial once per user, after the entrance animation completes.
  useEffect(() => {
    if (!user?.id || isEntering || isLeaving || tutorialShownRef.current) return
    if (hasTutorialBeenSeen(user.id)) return
    tutorialShownRef.current = true
    const id = window.setTimeout(() => setTutorialOpen(true), 1200)
    return () => window.clearTimeout(id)
  }, [user?.id, isEntering, isLeaving])

  const handleTutorialClose = () => {
    if (user?.id) markTutorialSeen(user.id)
    setTutorialOpen(false)
  }

  const handleRetakeTutorial = () => {
    setActiveHeaderTab('Play')
    setPlayView('menu')
    setTutorialOpen(true)
  }

  const handleTabClick = (tab) => {
    playSound('iw8Select')
    setActiveHeaderTab(tab)
  }

  const handleMenuItemClick = (item, source = 'mouse') => {
    playSound('iw8Select')
    setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
    setSuppressedMenuItem(item)
    if (item === 'Quick Play') {
      if (quickPlay) return // already running
      cancelQuickPlay()
      void startIW8QuickPlay()
    } else if (item === 'Server Browser') {
      cancelQuickPlay()
      setPlayView('browser')
    } else if (item === 'Host a Match') {
      cancelQuickPlay()
      setPlayView('host')
    }
  }

  const handleBackToMenu = (source = 'mouse') => {
    setPlayView('menu')
    setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
  }

  // Leaving is destructive (disconnect + membership cleanup), so it always
  // goes through a themed confirmation — Esc or the Leave Server button
  // both open it.
  const handleRequestLeaveServer = () => {
    playSound('iw8Select')
    setLeaveConfirmOpen(true)
  }

  // Leave the server we're connected to: the provider writes the
  // disconnect trigger then the MainMenuOffline lua trigger and clears
  // every session artifact (roster, membership row). We return to the Play
  // main menu.
  const handleLeaveServer = async () => {
    setLeaveConfirmOpen(false)
    // Jupiter content: use the session provider's leave flow.
    if (session) {
      await session.leaveServer()
    }
    // IW8 content: clear the local connected state.
    setIw8Connected(null)
    setActiveHeaderTab('Play')
    setPlayView('menu')
  }

  // IW8 join: open the join modal when a server is clicked in the browser.
  const handleIW8Join = (server) => {
    setIw8JoinServer(server)
  }

  // IW8 join modal Done: close the modal and enter the connected in-server screen.
  const handleIW8JoinDone = () => {
    setIw8Connected(iw8JoinServer)
    setIw8JoinServer(null)
    setPlayView('menu')
  }

  // ── IW8 Quick Play ───────────────────────────────────────────────────
  const cancelQuickPlay = useCallback(() => {
    qpBusyRef.current = false
    qpTokenRef.current += 1
    if (qpTimerRef.current) {
      window.clearInterval(qpTimerRef.current)
      qpTimerRef.current = null
    }
    setQuickPlay(null)
  }, [])

  // Poll for a joinable IW8 lobby (mod === 'iw8', valid lan_session).
  const pollForIW8Lobby = useCallback(async () => {
    const dev = buildDevServer(settings)
    if (dev && dev.mod === 'iw8' && dev.lanSession !== '') return dev
    if (!SUPABASE_CONFIGURED || !supabase) return null
    const { data, error } = await supabase
      .from('servers')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (
      (data || []).find(
        (row) => row.mod === 'iw8' &&
          isServerLeaseFresh(row) &&
          typeof row.lan_session === 'string' &&
          row.lan_session.trim() !== ''
      ) || null
    )
  }, [settings])

  // Show the found state and run the 3s countdown before opening the join modal.
  const showIW8Found = useCallback((target, token) => {
    setQuickPlay({ phase: 'found', server: target, countdown: 3 })
    let remaining = 3
    qpTimerRef.current = window.setInterval(() => {
      if (qpTokenRef.current !== token) {
        window.clearInterval(qpTimerRef.current)
        qpTimerRef.current = null
        return
      }
      remaining -= 1
      if (remaining > 0) {
        setQuickPlay((current) =>
          current && current.phase === 'found' ? { ...current, countdown: remaining } : current
        )
        return
      }
      // Countdown finished — open the IW8 join modal.
      qpTokenRef.current += 1
      window.clearInterval(qpTimerRef.current)
      qpTimerRef.current = null
      setQuickPlay(null)
      setIw8JoinServer(target)
    }, 1000)
  }, [])

  // Found a lobby: hold the searching state for the minimum time, then countdown.
  const beginIW8Found = useCallback((row) => {
    const target = {
      id: row.id,
      name: row.name,
      map: row.map,
      mode: row.mode,
      lanSession: (row.lanSession || row.lan_session || '').trim(),
      isDevServer: Boolean(row.isDevServer),
    }
    const token = ++qpTokenRef.current
    const hold = IW8_QP_MIN_SEARCH_MS - (Date.now() - qpSearchStartRef.current)
    if (hold > 0) {
      window.setTimeout(() => {
        if (qpTokenRef.current !== token) return
        showIW8Found(target, token)
      }, hold)
    } else {
      showIW8Found(target, token)
    }
  }, [showIW8Found])

  // Start the IW8 Quick Play search: poll every 5s for up to 60s.
  const startIW8QuickPlay = useCallback(async () => {
    if (qpBusyRef.current) return
    qpBusyRef.current = true
    setQuickPlay({ phase: 'searching', remaining: IW8_QP_SEARCH_S })
    const token = ++qpTokenRef.current
    qpSearchStartRef.current = Date.now()

    const devJoinable = Boolean(buildDevServer(settings)?.lanSession)
    if ((!SUPABASE_CONFIGURED || !supabase) && !devJoinable) {
      qpBusyRef.current = false
      setQuickPlay(null)
      setNoMatchModal('Matchmaking is offline — the server list is waiting on the backend connection.')
      return
    }

    // Immediate first poll.
    try {
      const row = await pollForIW8Lobby()
      if (qpTokenRef.current !== token) return
      if (row) {
        qpBusyRef.current = false
        beginIW8Found(row)
        return
      }
    } catch (err) {
      // Transient error — keep searching.
    }

    let remaining = IW8_QP_SEARCH_S
    qpTimerRef.current = window.setInterval(async () => {
      if (qpTokenRef.current !== token) {
        window.clearInterval(qpTimerRef.current)
        qpTimerRef.current = null
        return
      }
      remaining -= 1
      if (remaining <= 0) {
        window.clearInterval(qpTimerRef.current)
        qpTimerRef.current = null
        qpTokenRef.current += 1
        qpBusyRef.current = false
        setQuickPlay(null)
        setNoMatchModal('Quick Play searched for a full minute without finding any open IW8 lobbies. Try again or host your own match.')
        return
      }
      setQuickPlay((current) =>
        current && current.phase === 'searching' ? { ...current, remaining } : current
      )
      if (remaining % IW8_QP_POLL_STEP_S === 0) {
        try {
          const row = await pollForIW8Lobby()
          if (qpTokenRef.current !== token) return
          if (row) {
            window.clearInterval(qpTimerRef.current)
            qpTimerRef.current = null
            qpBusyRef.current = false
            beginIW8Found(row)
          }
        } catch (pollError) {
          // Transient error — keep searching.
        }
      }
    }, 1000)
  }, [beginIW8Found, pollForIW8Lobby, settings])

  // Clean up Quick Play on unmount.
  useEffect(() => () => cancelQuickPlay(), [cancelQuickPlay])

  // When IW8 join modal opens, cancel any active Quick Play.
  useEffect(() => {
    if (iw8JoinServer) cancelQuickPlay()
  }, [iw8JoinServer, cancelQuickPlay])

  const handleOpenQuitModal = () => {
    playSound('iw8Quit')
    setIsQuitModalOpen(true)
  }

  // Esc / controller-Back: on any non-Play tab, jump back to the Play tab
  // (landing on the Play MENU, not whatever subview was open — so the next
  // press opens the quit modal as expected); only on the Play tab does a
  // further press open the quit modal.
  const handleBack = () => {
    if (activeHeaderTab !== 'Play') {
      setPlayView('menu')
      handleTabClick('Play')
    } else if (inServer || iw8Connected) {
      // On the Play tab while connected, Esc / controller-Back asks whether
      // to leave the server instead of quitting the app.
      handleRequestLeaveServer()
    } else if (quickPlay) {
      // Cancel Quick Play search instead of opening quit modal.
      cancelQuickPlay()
    } else {
      handleOpenQuitModal()
    }
  }

  // Inside a Play subview (Server Browser / Host a Match) the child screen
  // owns arrow/A/B navigation — the interface hook only keeps the bumpers
  // (LB/RB) alive so the user can hop between tabs without backing out first.
  const isInSubView = activeHeaderTab === 'Play' && playView !== 'menu'
  const controllerItems = activeHeaderTab === 'Play' ? quitIdx + 1 : tabs.length + 1
  const activeTabIndex = tabs.indexOf(activeHeaderTab)
  const focusedControllerIndex = useControllerNavigation({
    itemCount: controllerItems,
    initialIndex: activeHeaderTab === 'Play' ? firstMenuIdx : activeTabIndex,
    allowedDirections: activeHeaderTab === 'Play' ? ['up', 'down'] : [],
    onNavigate: (direction, currentIndex) => {
      if (activeHeaderTab !== 'Play') return currentIndex
      // While Quick Play is searching or counting down, navigation collapses
      // to just the Quick Play slot + the quit button — the hidden Server
      // Browser / Host a Match slots are skipped.
      if (quickPlay || inServer) {
        if (direction === 'down') return currentIndex < firstMenuIdx ? firstMenuIdx : quitIdx
        if (direction === 'up') return currentIndex > firstMenuIdx ? firstMenuIdx : currentIndex
        return currentIndex
      }
      if (currentIndex < firstMenuIdx) return direction === 'down' ? firstMenuIdx : currentIndex
      if (direction === 'up') return Math.max(firstMenuIdx, currentIndex - 1)
      if (direction === 'down') return Math.min(quitIdx, currentIndex + 1)
      return currentIndex
    },
    enabled: !isEntering && !isLeaving && !isQuitModalOpen && !session?.join && !moddingErrorOpen && !interfaceModalOpen && !leaveConfirmOpen && !noMatchModal && !tutorialOpen,
    bumpersOnly: isInSubView,
    onConfirm: (index, source) => {
      setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
      if (index < tabs.length) {
        handleTabClick(tabs[index])
      } else if (activeHeaderTab === 'Play' && index <= lastMenuIdx) {
        // While connected the single menu slot is the Leave Server button
        // (through the confirmation).
        if (inServer) {
          handleRequestLeaveServer()
          return
        }
        // While Quick Play is active, map any stale menu index to Quick Play.
        const itemName = quickPlay ? 'Quick Play' : playItems[index - firstMenuIdx]
        handleMenuItemClick(itemName, source)
      } else {
        handleOpenQuitModal()
      }
    },
    onBack: handleBack,
    onBumper: (direction) => {
      setInputMode('controller')
      const nextTabIndex = direction === 'left'
        ? (activeTabIndex - 1 + tabs.length) % tabs.length
        : (activeTabIndex + 1) % tabs.length
      handleTabClick(tabs[nextTabIndex])
      return tabs[nextTabIndex] === 'Play' ? firstMenuIdx : nextTabIndex
    },
    onControllerActivity: () => setInputMode('controller'),
    onMove: () => {
      setInputMode('controller')
      setSuppressedMenuItem(null)
      handleHover()
    },
  })

  // Entering a server (join succeeded) hides the Server Browser / Host a
  // Match subviews — the Play tab snaps back to the connected panel.
  useEffect(() => {
    if (inServer) setPlayView('menu')
  }, [inServer])

  const handleQuitDesktop = async () => {
    setIsQuitModalOpen(false)
    try {
      await destroyAppWithServerCleanup(user?.id)
    } catch (err) {
      console.warn('[quit] destroy() failed; falling back to window.close()', err)
      try { window.close() } catch { /* nothing more we can do */ }
    }
  }

  const focusedQuitIdx = activeHeaderTab === 'Play' ? quitIdx : tabs.length

  return (
    <div className={`iw8-interface-container wallpaper-${mod} ${isEntering ? 'is-entering' : ''} ${isLeaving ? 'is-leaving' : ''}`} onMouseMove={handleMouseMove}>
      <header className="iw8-header">
        <div className="iw8-header-title">
          {/* With Jupiter content the logo swaps to Jupiter's (the IW8 shell
              stays, per Options > Dynamic Interfaces). The logo class follows
              the ASSET (not the shell) — each header sizes both assets for
              its own context in styles.css. */}
          <img src={isJupiterContent ? jupLogo : iw8Logo} alt={isJupiterContent ? 'Warzone III' : 'Warzone 1'} className={isJupiterContent ? 'header-logo-img-jup' : 'header-logo-img-iw8'} />
        </div>

        {/* Top Header Right Controls: User Chip */}
        <div className="iw8-header-right-tools">
          {user && (
            <button
              type="button"
              className="iw8-user-chip"
              onMouseEnter={handleHover}
              onClick={() => handleTabClick('Account')}
              aria-label={`Account: ${displayName}`}
              title={displayName}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
              </svg>
              <span>{displayName}</span>
            </button>
          )}
        </div>

        <div className="iw8-header-divider" aria-hidden="true" />

        <nav className="iw8-header-tabs">
          {tabs.map((tab) => {
            const tabIndex = tabs.indexOf(tab)
            const isControllerFocused = inputMode === 'controller' && focusedControllerIndex === tabIndex
            return (
              <button
                key={tab}
                className={`iw8-tab-btn ${activeHeaderTab === tab ? 'active' : ''} ${isControllerFocused ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={() => handleTabClick(tab)}
              >
                <span className="iw8-tab-label">{t('tab.' + tab.toLowerCase())}</span>
              </button>
            )
          })}
        </nav>
      </header>

      <main className="iw8-main-body">
        <div key={`${activeHeaderTab}-${playView}`} className="tab-slide-container">
          {activeHeaderTab === 'Play' && playView === 'browser' && !inServer && (
            <ServerBrowser theme="iw8" mod={mod} initialInputMode={inputMode} onBack={handleBackToMenu} onIW8Join={handleIW8Join} />
          )}

          {activeHeaderTab === 'Play' && playView === 'host' && !inServer && (
            <HostMatch theme="iw8" mod={mod} initialInputMode={inputMode} onBack={handleBackToMenu} />
          )}

          {activeHeaderTab === 'Play' && playView === 'menu' && (
            <>
              {inServer && isJupiterContent ? (
                <ConnectedServerPanel
                  theme="iw8"
                  lobby={currentLobby}
                  players={session?.lobbyMembers || []}
                  partyMembers={session?.partyMembers || []}
                  onLeaveServer={handleRequestLeaveServer}
                />
              ) : inServer && !isJupiterContent && iw8Connected ? (
                <section className="server-browser iw8-in-server">
                  <div className="server-browser-topline">
                    <div>
                      <span className="server-browser-kicker">PLAY / IN GAME</span>
                      <h1>CONNECTED</h1>
                      <p>You are currently playing on <strong>{iw8Connected.name}</strong>.</p>
                    </div>
                    <button
                      type="button"
                      className="connected-server-leave-btn"
                      onMouseEnter={handleHover}
                      onClick={() => {
                        playSound('iw8Select')
                        handleRequestLeaveServer()
                      }}
                    >
                      RETURN TO MAIN MENU
                    </button>
                  </div>
                </section>
              ) : (
                <div className="iw8-menu-vertical">
                  {quickPlay ? (
                    /* While Quick Play is active, show a single searching/status
                       button that pulses — clicking it cancels the search. */
                    <button
                      className={`iw8-menu-btn iw8-quickplay-active ${inputMode === 'controller' && focusedControllerIndex === firstMenuIdx ? 'controller-focused' : ''}`}
                      onClick={() => {
                        playSound('iw8Select')
                        cancelQuickPlay()
                      }}
                    >
                      {quickPlay.phase === 'searching' ? (
                        <span className="iw8-quickplay-searching">
                          <span className="iw8-quickplay-spinner" /> Searching for a match… ({quickPlay.remaining}s)
                        </span>
                      ) : (
                        <span className="iw8-quickplay-found">
                          Match found! Joining in {quickPlay.countdown}…
                        </span>
                      )}
                    </button>
                  ) : (
                    playItems.map((item, itemIndex) => {
                      const isControllerFocused = inputMode === 'controller' && focusedControllerIndex === firstMenuIdx + itemIndex
                      return (
                        <button
                          key={item}
                          className={`iw8-menu-btn ${item === 'Quick Play' ? 'iw8-quickplay-btn' : ''} ${isControllerFocused ? 'controller-focused' : ''} ${suppressedMenuItem === item ? 'placeholder-suppressed' : ''}`}
                          onMouseEnter={() => {
                            setSuppressedMenuItem(null)
                            handleHover()
                          }}
                          onMouseLeave={() => setSuppressedMenuItem(null)}
                          onClick={() => handleMenuItemClick(item)}
                        >
                          {item === 'Quick Play' ? t('play.quickplay') : item === 'Server Browser' ? t('play.serverbrowser') : item === 'Host a Match' ? t('play.hostmatch') : item}
                        </button>
                      )
                    })
                  )}
                </div>
              )}
            </>
          )}

          {activeHeaderTab === 'RTM' && isJupiterContent && <ModdingTab theme="iw8" onModalChange={setModdingErrorOpen} />}
          {activeHeaderTab === 'Account' && <AccountTab theme="iw8" />}
          {activeHeaderTab === 'Social' && (
            <SocialTab
              theme="iw8"
              onSwitchToAccount={() => handleTabClick('Account')}
            />
          )}
          {activeHeaderTab === 'Help' && <HelpTab theme="iw8" mod={mod} />}
          {activeHeaderTab === 'Options' && <OptionsTab theme="iw8" onModalChange={setInterfaceModalOpen} onRetakeTutorial={handleRetakeTutorial} />}
        </div>
      </main>

      {/* Right-side player roster HUD — everyone in the joined lobby
          (party members tagged PARTY) or the party squad when not in a
          lobby, with a LEAVE SERVER button while connected. Pinned below
          the header's user chip; persists across tabs. Renders nothing
          for IW8 content (no session provider). */}
      <PlayerRoster theme="iw8" />

      {/* Bottom Right Toolbar (Quit) */}
      <div className="iw8-quit-btn-wrapper">
        <button
          className={`iw8-quit-btn ${inputMode === 'controller' && focusedControllerIndex === focusedQuitIdx ? 'controller-focused' : ''}`}
          onMouseEnter={handleHover}
          onClick={handleOpenQuitModal}
        >
          Quit
        </button>
      </div>

      {/* Bottom Left Controller Hint — platform glyph next to Select */}
      {inputMode === 'controller' && (
        <div className="iw8-controller-hint-bar" aria-label="Controller controls">
          <span className="iw8-controller-hint">
            <img className="glyph-img hint-glyph-img" src={glyphSrc(glyphPlatform, 'confirm')} alt="" aria-hidden="true" />
            Select
          </span>
        </div>
      )}

      <IW8QuitModal
        isOpen={isQuitModalOpen}
        onClose={() => setIsQuitModalOpen(false)}
        onGoLauncher={onGoLauncher}
        onQuitDesktop={handleQuitDesktop}
      />

      <LeaveServerConfirmModal
        theme="iw8"
        isOpen={leaveConfirmOpen}
        onConfirm={() => void handleLeaveServer()}
        onCancel={() => setLeaveConfirmOpen(false)}
      />

      <IW8JoinModal
        isOpen={Boolean(iw8JoinServer)}
        serverName={iw8JoinServer?.name || ''}
        lanSession={iw8JoinServer?.lanSession || ''}
        onDone={handleIW8JoinDone}
        onCancel={() => setIw8JoinServer(null)}
      />

      <JupiterQuickPlayModal
        isOpen={Boolean(noMatchModal)}
        message={noMatchModal}
        onSearchAgain={() => {
          setNoMatchModal(null)
          void startIW8QuickPlay()
        }}
        onCancel={() => setNoMatchModal(null)}
      />

      <AuthRequiredNotice
        theme="iw8"
        entranceActive={isEntering || isLeaving}
        onSwitchToAccount={() => handleTabClick('Account')}
      />

      <TutorialOverlay
        isOpen={tutorialOpen}
        theme="iw8"
        onClose={handleTutorialClose}
      />
    </div>
  )
}
