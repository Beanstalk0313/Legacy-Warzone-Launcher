import React, { useEffect, useState } from 'react'
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
import AuthRequiredNotice from './AuthRequiredNotice'
import BetaWelcomeModal, { hasBetaWelcomeAcknowledged } from './BetaWelcomeModal'
import { useAuth } from './AuthProvider'
import { getDisplayName } from '../utils/displayName'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { destroyAppWithServerCleanup } from '../utils/serverPresence'
import JupiterSessionProvider, { useJupiterSession } from '../utils/jupiterSession'
import iw8Logo from '../assets/iw8_logo.png'
import jupLogo from '../assets/jup_logo.png'

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
  const displayName = user ? getDisplayName(user) : ''
  // Six tabs when Jupiter content (RTM tab is Jupiter-specific UI), five
  // without. Discord merged into Help (one "Help" tab now lists the mod's
  // community servers + support cards):
  // Play | RTM | Account | Social | Help | Options
  const tabs = isJupiterContent
    ? ['Play', 'RTM', 'Account', 'Social', 'Help', 'Options']
    : ['Play', 'Account', 'Social', 'Help', 'Options']
  const playItems = ['Quick Play', 'Server Browser', 'Host a Match']

  // While connected to a server (join result / still in-game after the
  // modal), the play menu collapses to the connected panel's single Leave
  // Server button — the index math shrinks the menu to one slot so
  // controller focus never lands on a hidden item.
  const inServer = Boolean(session?.connected)
  const currentLobby = session?.currentLobby || null
  const menuCount = inServer ? 1 : playItems.length
  const firstMenuIdx = tabs.length
  const lastMenuIdx = tabs.length + menuCount - 1
  const quitIdx = tabs.length + menuCount

  const [activeHeaderTab, setActiveHeaderTab] = useState('Play')
  const [isQuitModalOpen, setIsQuitModalOpen] = useState(false)
  // Leave-server confirmation: Esc on the in-game screen or the Leave
  // Server button opens it — leaving disconnects and returns to the menu,
  // so it's worth an explicit confirm (same quiet-down gating).
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [suppressedMenuItem, setSuppressedMenuItem] = useState(null)
  const [inputMode, setInputMode] = useState('mouse')
  const [playView, setPlayView] = useState('menu')
  // True while the Modding tab's error modal is open — its own controller
  // hook handles the keys, so the interface hook must go quiet (mirrors the
  // `!session?.join` gating).
  const [moddingErrorOpen, setModdingErrorOpen] = useState(false)
  // True while the Options tab's interface-reload confirmation is open —
  // same quiet-down reasoning as moddingErrorOpen.
  const [interfaceModalOpen, setInterfaceModalOpen] = useState(false)
  const [betaWelcomeOpen, setBetaWelcomeOpen] = useState(() => !hasBetaWelcomeAcknowledged())

  const handleMouseMove = (event) => {
    if (event.movementX !== 0 || event.movementY !== 0) setInputMode('mouse')
  }

  const handleHover = () => playSound('iw8Hover')

  const handleTabClick = (tab) => {
    playSound('iw8Select')
    setActiveHeaderTab(tab)
  }

  const handleMenuItemClick = (item, source = 'mouse') => {
    playSound('iw8Select')
    setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
    setSuppressedMenuItem(item)
    if (item === 'Server Browser') setPlayView('browser')
    if (item === 'Host a Match') setPlayView('host')
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

  // Leave the server we're connected to: the provider runs RTM.exe
  // -disconnect + -lua MainMenuOffline and clears every session artifact
  // (roster, membership row). We return to the Play main menu.
  const handleLeaveServer = async () => {
    if (!session) return
    setLeaveConfirmOpen(false)
    await session.leaveServer()
    setActiveHeaderTab('Play')
    setPlayView('menu')
  }

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
    } else if (inServer) {
      // On the Play tab while connected, Esc / controller-Back asks whether
      // to leave the server instead of quitting the app.
      handleRequestLeaveServer()
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
      if (currentIndex < firstMenuIdx) return direction === 'down' ? firstMenuIdx : currentIndex
      if (direction === 'up') return Math.max(firstMenuIdx, currentIndex - 1)
      if (direction === 'down') return Math.min(quitIdx, currentIndex + 1)
      return currentIndex
    },
    enabled: !isEntering && !isLeaving && !isQuitModalOpen && !session?.join && !moddingErrorOpen && !interfaceModalOpen && !leaveConfirmOpen && !betaWelcomeOpen,
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
        handleMenuItemClick(playItems[index - firstMenuIdx], source)
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
                <span className="iw8-tab-label">{tab}</span>
              </button>
            )
          })}
        </nav>
      </header>

      <main className="iw8-main-body">
        <div key={`${activeHeaderTab}-${playView}`} className="tab-slide-container">
          {activeHeaderTab === 'Play' && playView === 'browser' && !inServer && (
            <ServerBrowser theme="iw8" mod={mod} initialInputMode={inputMode} onBack={handleBackToMenu} />
          )}

          {activeHeaderTab === 'Play' && playView === 'host' && !inServer && (
            <HostMatch theme="iw8" mod={mod} initialInputMode={inputMode} onBack={handleBackToMenu} />
          )}

          {activeHeaderTab === 'Play' && playView === 'menu' && (
            <>
              {inServer ? (
                <ConnectedServerPanel
                  theme="iw8"
                  lobby={currentLobby}
                  players={session?.lobbyMembers || []}
                  partyMembers={session?.partyMembers || []}
                  onLeaveServer={handleRequestLeaveServer}
                />
              ) : (
                <div className="iw8-menu-vertical">
                  {playItems.map((item, itemIndex) => {
                    const isControllerFocused = inputMode === 'controller' && focusedControllerIndex === firstMenuIdx + itemIndex
                    return (
                      <button
                        key={item}
                        className={`iw8-menu-btn ${isControllerFocused ? 'controller-focused' : ''} ${suppressedMenuItem === item ? 'placeholder-suppressed' : ''}`}
                        onMouseEnter={() => {
                          setSuppressedMenuItem(null)
                          handleHover()
                        }}
                        onMouseLeave={() => setSuppressedMenuItem(null)}
                        onClick={() => handleMenuItemClick(item)}
                      >
                        {item}
                      </button>
                    )
                  })}
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
          {activeHeaderTab === 'Options' && <OptionsTab theme="iw8" onModalChange={setInterfaceModalOpen} />}
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

      <BetaWelcomeModal
        theme="iw8"
        isOpen={betaWelcomeOpen}
        onAcknowledge={() => setBetaWelcomeOpen(false)}
      />

      <AuthRequiredNotice
        theme="iw8"
        entranceActive={isEntering || isLeaving}
        onSwitchToAccount={() => handleTabClick('Account')}
      />
    </div>
  )
}
