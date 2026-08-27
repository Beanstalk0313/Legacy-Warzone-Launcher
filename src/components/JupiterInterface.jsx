import React, { useCallback, useEffect, useRef, useState } from 'react'
import JupiterQuitModal from './JupiterQuitModal'
import JupiterQuickPlayModal from './JupiterQuickPlayModal'
import GameUninstallModal from './GameUninstallModal'
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
import { useAuth } from './AuthProvider'
import { useSettings } from './SettingsProvider'
import JupiterErrorModal from './JupiterErrorModal'
import { getDisplayName } from '../utils/displayName'
import { buildDevServer } from '../utils/devServer'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { useGlyphPlatform, glyphSrc } from '../utils/glyphs'
import { useGameInstall } from '../utils/gameInstall'
import { destroyAppWithServerCleanup, isServerLeaseFresh } from '../utils/serverPresence'
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase'
import JupiterSessionProvider, { useJupiterSession } from '../utils/jupiterSession'
import JupiterInstallModal from './JupiterInstallModal'
import TutorialOverlay, { hasTutorialBeenSeen, markTutorialSeen } from './TutorialOverlay'
import { useTranslation } from '../utils/i18n'
import jupLogo from '../assets/jup_logo.png'
import jupWarzoneLogo from '../assets/jup_warzone_logo.png'
import jupZombiesLogo from '../assets/jup_zombies_logo.png'
import iw8Logo from '../assets/iw8_logo.png'
import { runRtm, runJupiterPrepSequence, isTauriRuntime } from '../utils/jupiterRtm'
import jupQuickImg from '../assets/jup_quick.jpg'
import jupQuickIcon from '../assets/jup_quick_icon.png'
import jupQuickIconWarzone from '../assets/jup_quick_icon_warzone.png'
import jupQuickIconZombies from '../assets/jup_zombies_quick_icon.png'
import jupSearchingImg from '../assets/jup_searching.png'
import jupFoundImg from '../assets/quick_play_found.jpg'
import jupBrowseImg from '../assets/jup_browse.jpg'
import jupHostImg from '../assets/jup_host.jpg'
import jupWarzoneBrowseImg from '../assets/jup_warzone_browse.jpg'
import jupWarzoneHostImg from '../assets/jup_warzone_host.jpg'
import jupZombiesBrowseImg from '../assets/jup_zombies_browse.jpg'
import jupZombiesHostImg from '../assets/jup_zombies_host.jpg'
import jupInstallImg from '../assets/jup_install.jpg'
import jupPlayImg from '../assets/jup_play.jpg'

// Card images and icons vary by game mode (multiplayer / warzone / zombies).
// Quick Play always uses the same background image; only its badge icon
// changes for warzone mode.
function getCardDetailsForMode(gameMode) {
  const browseImg = gameMode === 'warzone' ? jupWarzoneBrowseImg : gameMode === 'zombies' ? jupZombiesBrowseImg : jupBrowseImg
  const hostImg = gameMode === 'warzone' ? jupWarzoneHostImg : gameMode === 'zombies' ? jupZombiesHostImg : jupHostImg
  const quickIcon = gameMode === 'warzone' ? jupQuickIconWarzone : gameMode === 'zombies' ? jupQuickIconZombies : jupQuickIcon
  return {
    'Quick Play': { title: 'Quick Play', subtitle: 'Find any open match', image: jupQuickImg, imageAlt: 'Quick Play — cinematic squad shot', icon: quickIcon },
    'Server Browser': { title: 'Server Browser', subtitle: 'Browse & join custom tactical servers', image: browseImg, imageAlt: 'Server Browser — island map overview' },
    'Host a Match': { title: 'Host a Match', subtitle: 'Host your own dedicated server', image: hostImg, imageAlt: 'Host a Match — combat screenshot' },
  }
}



// Fourth Play-card slot, only shown for Jupiter content (installing/launching
// the Jupiter game is a Jupiter-only feature). Its label + progress are
// dynamic, so it isn't part of the static cardDetails map — it's handled
// separately in nav math and rendering.
const INSTALL_CARD = 'Install & Play'

// Quick Play searches for a joinable lobby for a full minute (polling the
// servers table every 5 s) before giving up and showing the no-match modal.
const QUICK_PLAY_SEARCH_S = 60
const QUICK_PLAY_POLL_STEP_S = 5
// The searching decal must stay visible for at least this long before a
// found lobby's countdown takes over — otherwise an instantly-available
// lobby (e.g. the local dev server) would skip the searching image
// entirely, because both state updates land in the same render batch.
const QUICK_PLAY_MIN_SEARCH_MS = 1200

// `mod` is the CONTENT mod the shell renders. Normally it matches the shell
// (Jupiter shell + Jupiter content), but Options > Dynamic Interfaces can
// swap the shell independently (e.g. IW8 content inside the Jupiter shell —
// no Modding tab, no RTM session provider, IW8 logo, with Jupiter styling).
export default function JupiterInterface({ mod = 'jupiter', ...props }) {
  if (mod === 'jupiter') {
    return (
      <JupiterSessionProvider theme="jupiter">
        <JupiterInterfaceContent {...props} mod={mod} />
      </JupiterSessionProvider>
    )
  }
  // IW8 content doesn't need the RTM session provider.
  return <JupiterInterfaceContent {...props} mod={mod} />
}

// The inner content lives INSIDE JupiterSessionProvider so it can read the
// session context: while a join/host modal is open, the interface's own
// controller nav must go quiet, otherwise Enter/Esc double-fire on both the
// modal and the menu behind it (e.g. a party auto-join can open the quit
// modal over the join modal).
function JupiterInterfaceContent({ mod = 'jupiter', onSwitchMod, onGoLauncher, isEntering = false, isLeaving = false, gameMode = 'multiplayer' }) {
  const { user } = useAuth()
  const { settings, setSetting } = useSettings()
  const { t } = useTranslation()
  const session = useJupiterSession() // null without a provider (IW8 content)
  const isJupiterContent = mod === 'jupiter'
  const displayName = user ? getDisplayName(user) : ''

  // ── Game mode: logo + accent + RTM auto-trigger ──────────────────────
  const isZombiesMode = gameMode === 'zombies'
  const isWarzoneMode = gameMode === 'warzone'
  const modeLogo = isZombiesMode ? jupZombiesLogo : isWarzoneMode ? jupWarzoneLogo : jupLogo
  const modeAlt = isZombiesMode ? 'Zombies' : isWarzoneMode ? 'Warzone' : 'Multiplayer'

  // Card details + keys vary by game mode (browse/host images, quick play icon).
  const cardDetails = getCardDetailsForMode(gameMode)
  const cardKeys = Object.keys(cardDetails)

  // Auto-run RTM command on mount when entering with a specific mode
  const autoRanRef = useRef(false)
  useEffect(() => {
    if (!isJupiterContent || autoRanRef.current || !isTauriRuntime()) return
    if (gameMode === 'multiplayer') return
    autoRanRef.current = true
    ;(async () => {
      try {
        if (gameMode === 'zombies') {
          await runRtm(['-setzombies'])
        } else if (gameMode === 'warzone') {
          await runJupiterPrepSequence(1500)
        }
      } catch (err) {
        console.warn('[jupiter] auto mode switch failed', err)
      }
    })()
  }, [isJupiterContent, gameMode])

  // Zombies accent override
  const zombiesAccentOverride = isZombiesMode ? { '--jupiter-accent': '#601212', '--jupiter-accent-hover': '#7a1818' } : null
  // Six tabs with Jupiter content (RTM tab is Jupiter-specific UI); five
  // without (IW8 content). Discord merged into Help (one "Help" tab lists
  // the mod's community servers + support cards):
  // Play | RTM | Account | Social | Help | Options
  const tabs = isJupiterContent
    ? ['Play', 'RTM', 'Account', 'Social', 'Help', 'Options']
    : ['Play', 'Account', 'Social', 'Help', 'Options']

  // The install/launch card only exists for Jupiter content. Nav math and the
  // card row below iterate this (rather than the static cardKeys) so the
  // controller can reach the extra tile and the quit button still follows it.
  const cardKeysWithInstall = isJupiterContent ? [...cardKeys, INSTALL_CARD] : cardKeys

  // While connected to a server (join result / still in-game after the
  // modal), the play cards are replaced by the connected panel's
  // single Leave Server button — the menu shrinks to one slot so controller
  // focus can never land on a hidden card.
  const inServer = Boolean(session?.connected)
  const currentLobby = session?.currentLobby || null
  const cardCount = inServer ? 1 : cardKeysWithInstall.length
  const firstCardIdx = tabs.length
  const lastCardIdx = tabs.length + cardCount - 1
  const quitIdx = tabs.length + cardCount

  const [activeHeaderTab, setActiveHeaderTab] = useState('Play')
  const [hoveredCard, setHoveredCard] = useState('Quick Play')
  // Full Jupiter game install/launch lifecycle (driven by the install-path
  // setting). `installError` surfaces download/extract failures in a themed
  // dialog.
  const installGame = useGameInstall(settings?.game_install_path || '')
  const [installError, setInstallError] = useState(null)
  const [installModalOpen, setInstallModalOpen] = useState(false)
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = useState(false)
  // Bumped when the user hovers / focuses the Launch Game card so the
  // center divider in its blue bar re-mounts and replays its slide-down.
  const [installDividerKey, setInstallDividerKey] = useState(0)
  const { glyphPlatform } = useGlyphPlatform()
  const [isQuitModalOpen, setIsQuitModalOpen] = useState(false)
  const [inputMode, setInputMode] = useState('mouse')
  // Tutorial: shown once per user after first sign-in in this interface.
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const tutorialShownRef = useRef(false)
  const [playView, setPlayView] = useState('menu')
  // True while the Modding tab's error modal is open — its own controller
  // hook handles the keys, so the interface hook must go quiet (mirrors
  // the `!session?.join` gating).
  const [moddingErrorOpen, setModdingErrorOpen] = useState(false)
  // True while the Options tab's interface-reload confirmation is open —
  // same quiet-down reasoning as moddingErrorOpen.
  const [interfaceModalOpen, setInterfaceModalOpen] = useState(false)
  // Leave-server confirmation: Esc on the in-game screen or the Leave
  // Server button opens it — leaving disconnects and returns to the menu,
  // so it's worth an explicit confirm (same quiet-down gating).
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  // Quick Play auto-matchmaking: finds a Jupiter lobby, runs a 3s
  // countdown, then auto-joins via the session provider. The Quick Play
  // tile pulses (is-quickplay-active) while the flow is active — the image
  // morphs to the searching decal during the search, then a countdown pill
  // (JOINING IN n) appears over the tile for the 3s auto-join countdown.
  // `phase` is 'searching' (polling the minute) | 'found' (counting down
  // with the chosen server).
  const [quickPlay, setQuickPlay] = useState(null)
  // Message shown by the no-match modal (null = closed). The 'none' panel
  // was replaced with this modal per product direction — after a full
  // minute of searching with no result, a real dialog appears.
  const [noMatchModal, setNoMatchModal] = useState(null)
  // Guards double-clicks on the Quick Play card (the state guard alone can
  // race across a fast re-click before the re-render lands).
  const quickPlayBusyRef = useRef(false)
  // Invalidated by cancelQuickPlay() and on auto-join so a stale interval
  // tick can never fire beginJoin after the flow was cancelled.
  const quickPlayTokenRef = useRef(0)
  const quickPlayTimerRef = useRef(null)
  // When the current search started — guarantees the searching phase is
  // visible for QUICK_PLAY_MIN_SEARCH_MS even when a lobby is found on the
  // very first poll (instant finds, e.g. the local dev server).
  const quickPlaySearchStartRef = useRef(0)

  const handleMouseMove = (event) => {
    if (event.movementX !== 0 || event.movementY !== 0) setInputMode('mouse')
  }

  const handleHover = () => playSound('jupHover')

  // Open the tutorial once per user, after the entrance animation completes.
  useEffect(() => {
    if (!user?.id || isEntering || isLeaving || tutorialShownRef.current) return
    if (hasTutorialBeenSeen(user.id)) return
    tutorialShownRef.current = true
    // Give the interface entrance animation 1.2s to finish before the overlay.
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

  // ── Quick Play: search 60s → countdown → auto-join ────────────────────
  // Clicking Quick Play swaps the tile decal to jup_searching.png (with a
  // subtle breathing pulse — see .is-quickplay-active in styles.css), hides
  // the other two tiles, and searches for a joinable Jupiter lobby (mod +
  // valid lan_session) for a full minute — polling every 5 s. The first
  // lobby found switches the decal back and runs a 3 s auto-join countdown,
  // then hands the server to `session.beginJoin(server, 'quickplay')` (the
  // normal prep sequence + guided join modal). If the whole minute passes
  // with nothing found, a themed modal offers Search Again / Cancel. The
  // search/countdown KEEPS RUNNING across tab switches — the state lives
  // here in the interface, not in the tab content — so deliberate cancels
  // only: Esc/back or the back arrow on the Play tab, picking another
  // card, or leaving the interface (unmount cleanup below).
  const cancelQuickPlay = useCallback(() => {
    quickPlayBusyRef.current = false
    quickPlayTokenRef.current += 1
    if (quickPlayTimerRef.current) {
      window.clearInterval(quickPlayTimerRef.current)
      quickPlayTimerRef.current = null
    }
    setQuickPlay(null)
  }, [])

  // One poll for a joinable Jupiter lobby (client-side mod filter, same
  // degrade-gracefully pattern as ServerBrowser). Returns null when none.
  // Developer Mode: the local test server is a first-class matchmaking
  // candidate — like any real lobby it must have a LAN session to be
  // joinable, and it sits at the top of the pool so dev mode finds it
  // first (it's also the only candidate when the backend is unreachable).
  const pollForJoinableLobby = useCallback(async () => {
    const dev = buildDevServer(settings)
    if (dev && dev.lanSession !== '') return dev
    if (!SUPABASE_CONFIGURED || !supabase) return null
    const { data, error } = await supabase
      .from('servers')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (
      (data || []).find(
        (row) => row.mod === 'jupiter' &&
          (row.isDevServer || (row.game_mode || 'multiplayer') === gameMode) &&
          isServerLeaseFresh(row) &&
          typeof row.lan_session === 'string' &&
          row.lan_session.trim() !== ''
      ) || null
    )
  }, [settings, gameMode])

  // Swap to the 'found' phase (tiles stay collapsed, decal back to the
  // quick artwork, countdown pill appears) and run the 3s auto-join
  // countdown. `token` is the flow token captured when the lobby was found
  // — a cancel during the search-hold bumps it, so this can't fire late.
  const showFound = useCallback((target, token) => {
    setQuickPlay({ phase: 'found', server: target, countdown: 3 })
    let remaining = 3
    quickPlayTimerRef.current = window.setInterval(() => {
      if (quickPlayTokenRef.current !== token) {
        window.clearInterval(quickPlayTimerRef.current)
        quickPlayTimerRef.current = null
        return
      }
      remaining -= 1
      if (remaining > 0) {
        setQuickPlay((current) =>
          current && current.phase === 'found' ? { ...current, countdown: remaining } : current
        )
        return
      }
      // Countdown hit zero → auto-join. Null the panel in the same tick
      // so the join modal (rendered globally by the provider) takes over.
      quickPlayTokenRef.current += 1
      window.clearInterval(quickPlayTimerRef.current)
      quickPlayTimerRef.current = null
      setQuickPlay(null)
      void session.beginJoin(target, 'quickplay')
    }, 1000)
  }, [session])

  // Found a lobby: keep the searching decal up for the remaining minimum
  // search time (so the image morph is always visible, even for an instant
  // find like the local dev server), then run the countdown. Dev rows carry
  // camelCase `lanSession` (buildDevServer); Supabase rows use `lan_session`
  // — normalize both so the two sources join identically.
  const beginFound = useCallback((row) => {
    const target = {
      id: row.id,
      name: row.name,
      map: row.map,
      mode: row.mode,
      lanSession: (row.lanSession || row.lan_session || '').trim(),
      isDevServer: Boolean(row.isDevServer),
    }
    const token = ++quickPlayTokenRef.current
    const hold = QUICK_PLAY_MIN_SEARCH_MS - (Date.now() - quickPlaySearchStartRef.current)
    if (hold > 0) {
      window.setTimeout(() => {
        if (quickPlayTokenRef.current !== token) return
        showFound(target, token)
      }, hold)
    } else {
      showFound(target, token)
    }
  }, [showFound])

  const startQuickPlay = useCallback(async () => {
    // Jupiter content only — IW8 content renders without the session
    // provider, so there is no join flow to hand the server to.
    if (!session || session.join || quickPlayBusyRef.current) return
    quickPlayBusyRef.current = true
    setQuickPlay({ phase: 'searching', remaining: QUICK_PLAY_SEARCH_S })
    const token = ++quickPlayTokenRef.current
    quickPlaySearchStartRef.current = Date.now()

    // Matchmaking can't reach the backend at all — don't burn the full
    // minute searching; go straight to the no-match modal. Exception: a
    // joinable dev server (Developer Mode + LAN session) is local and
    // still works, so the search proceeds and finds it immediately.
    const devJoinable = Boolean(buildDevServer(settings)?.lanSession)
    if ((!SUPABASE_CONFIGURED || !supabase) && !devJoinable) {
      quickPlayBusyRef.current = false
      setQuickPlay(null)
      setNoMatchModal('Matchmaking is offline — the server list is waiting on the backend connection.')
      return
    }

    // Immediate first poll, then every 5 s from the second counter.
    try {
      const row = await pollForJoinableLobby()
      if (quickPlayTokenRef.current !== token) return
      if (row) {
        quickPlayBusyRef.current = false
        beginFound(row)
        return
      }
    } catch (err) {
      // Transient error — keep searching; the next poll may succeed.
    }

    let remaining = QUICK_PLAY_SEARCH_S
    quickPlayTimerRef.current = window.setInterval(async () => {
      if (quickPlayTokenRef.current !== token) {
        window.clearInterval(quickPlayTimerRef.current)
        quickPlayTimerRef.current = null
        return
      }
      remaining -= 1
      if (remaining <= 0) {
        // A whole minute with no match → themed modal (Search Again/Cancel).
        window.clearInterval(quickPlayTimerRef.current)
        quickPlayTimerRef.current = null
        quickPlayTokenRef.current += 1
        quickPlayBusyRef.current = false
        setQuickPlay(null)
        setNoMatchModal('Quick Play searched for a full minute without finding any open lobbies. Try again or host your own match.')
        return
      }
      setQuickPlay((current) =>
        current && current.phase === 'searching' ? { ...current, remaining } : current
      )
      if (remaining % QUICK_PLAY_POLL_STEP_S === 0) {
        try {
          const row = await pollForJoinableLobby()
          if (quickPlayTokenRef.current !== token) return
          if (row) {
            window.clearInterval(quickPlayTimerRef.current)
            quickPlayTimerRef.current = null
            quickPlayBusyRef.current = false
            beginFound(row)
          }
        } catch (pollError) {
          // Transient error — keep searching.
        }
      }
    }, 1000)
  }, [beginFound, pollForJoinableLobby, session])

  const handleNoMatchSearchAgain = () => {
    setNoMatchModal(null)
    void startQuickPlay()
  }

  const handleNoMatchCancel = () => {
    setNoMatchModal(null)
  }

  // Cancel any pending countdown if the play menu unmounts (mod switch /
  // back to launcher / interface swap).
  useEffect(() => () => cancelQuickPlay(), [cancelQuickPlay])

  // Entering a server (join succeeded) hides the Server Browser / Host a
  // Match subviews — the Play tab snaps back to the connected panel.
  useEffect(() => {
    if (inServer) setPlayView('menu')
  }, [inServer])

  // Switching tabs never interrupts an active Quick Play search — the
  // flow keeps running in the background and the tile resumes its pulse
  // when the user returns to the Play tab.
  const handleTabClick = (tab) => {
    playSound('jupSelect')
    setActiveHeaderTab(tab)
  }

  const handleCardMouseEnter = (cardName) => {
    playSound('jupHover')
    setHoveredCard(cardName)
    if (cardName === INSTALL_CARD) setInstallDividerKey((key) => key + 1)
  }

  // The Install tile: if the game is installed it launches; otherwise it opens
  // the install modal (path field → Install → progress). While an install is
  // running this still reopens the modal so the user can watch progress or
  // cancel it after pressing Close.
  const handleInstallCardClick = () => {
    playSound('jupSelect')
    if (installGame.installed) {
      void installGame.launch().catch((error) => {
        setInstallError(String(error?.message || error))
      })
      return
    }
    setInstallModalOpen(true)
  }

  // Uninstall: opens the confirmation modal, then deletes the game folder.
  const handleUninstallClick = (e) => {
    e?.stopPropagation()
    playSound('jupSelect')
    setUninstallConfirmOpen(true)
  }

  const handleUninstallConfirm = async () => {
    setUninstallConfirmOpen(false)
    try {
      await installGame.uninstall()
    } catch (error) {
      setInstallError(String(error?.message || error))
    }
  }

  const handleCardClick = (cardName, source = 'mouse') => {
    playSound('jupSelect')
    setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
    // While a Quick Play flow is already active, clicking the pulsing Quick
    // Play tile is a no-op — the tile is the search indicator now, not a
    // restart button, so a stray click can't discard the search progress.
    if (cardName === 'Quick Play' && quickPlay) return
    // Picking any card cancels a pending countdown first — the Quick Play
    // branch below restarts it fresh.
    cancelQuickPlay()
    if (cardName === 'Quick Play') {
      void startQuickPlay()
    } else if (cardName === 'Server Browser') {
      setPlayView('browser')
    } else if (cardName === 'Host a Match') {
      setPlayView('host')
    } else if (cardName === INSTALL_CARD) {
      void handleInstallCardClick()
    }
  }

  const handleBackToMenu = (source = 'mouse') => {
    cancelQuickPlay()
    setPlayView('menu')
    setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
  }

  // Leaving is destructive (disconnect + membership cleanup), so it always
  // goes through a themed confirmation — Esc, the back arrow, or the Leave
  // Server button all open it.
  const handleRequestLeaveServer = () => {
    playSound('jupSelect')
    setLeaveConfirmOpen(true)
  }

  // Leave the server we're connected to: the provider writes the
  // disconnect trigger then the MainMenuOffline lua trigger and clears
  // every session artifact (roster, membership row). We return to the Play
  // main menu.
  const handleLeaveServer = async () => {
    if (!session) return
    setLeaveConfirmOpen(false)
    await session.leaveServer()
    setActiveHeaderTab('Play')
    setPlayView('menu')
  }

  const handleOpenQuitModal = () => {
    playSound('jupQuit')
    setIsQuitModalOpen(true)
  }

  // Esc / controller-Back: on any non-Play tab, jump back to the Play tab
  // (landing on the Play MENU, not whatever subview was open — so the next
  // press opens the quit modal as expected); only on the Play tab does a
  // further press open the quit modal.
  const handleBack = () => {
    // On a non-Play tab, Esc / controller-Back jumps back to the Play tab
    // WITHOUT interrupting a running Quick Play search.
    if (activeHeaderTab !== 'Play') {
      setPlayView('menu')
      handleTabClick('Play')
      return
    }
    // On the Play tab while connected, Esc / controller-Back asks whether
    // to leave the server instead of quitting the app.
    if (inServer) {
      handleRequestLeaveServer()
      return
    }
    // On the Play tab, Esc / controller-Back while matchmaking cancels the
    // search — it must not open the quit modal mid-search.
    if (quickPlay) {
      cancelQuickPlay()
      return
    }
    handleOpenQuitModal()
  }

  const isInSubView = activeHeaderTab === 'Play' && playView !== 'menu'
  // The top-left back arrow is context-aware: inside a Play subview it
  // returns to the Play main menu; on any non-Play tab it jumps back to the
  // Play tab's main menu; everywhere else it opens the quit modal.
  const handleQuitArrowClick = () => {
    if (isInSubView) {
      playSound('jupSelect')
      handleBackToMenu('mouse')
    } else if (activeHeaderTab !== 'Play') {
      // Back arrow on a non-Play tab returns to the Play tab's main menu —
      // a running Quick Play search keeps running.
      setPlayView('menu')
      handleTabClick('Play')
    } else if (inServer) {
      // While connected the back arrow asks whether to leave the server
      // (return to the menu), not quit to desktop.
      handleRequestLeaveServer()
    } else if (quickPlay) {
      // On the Play tab the back arrow means quit — cancel the search
      // instead of opening the quit modal mid-search.
      cancelQuickPlay()
    } else {
      handleOpenQuitModal()
    }
  }

  // Inside a Play subview (Server Browser / Host a Match) the child screen
  // owns arrow/A/B navigation — the interface hook only keeps the bumpers
  // (LB/RB) alive so the user can hop between tabs without backing out first.
  const controllerItems = activeHeaderTab === 'Play' ? quitIdx + 1 : tabs.length + 1
  const activeTabIndex = tabs.indexOf(activeHeaderTab)
  const focusedControllerIndex = useControllerNavigation({
    itemCount: controllerItems,
    initialIndex: activeHeaderTab === 'Play' ? firstCardIdx : activeTabIndex,
    allowedDirections: activeHeaderTab === 'Play' ? ['left', 'right'] : [],
    onNavigate: (direction, currentIndex) => {
      if (activeHeaderTab !== 'Play') return currentIndex
      // While matchmaking hides the other two cards, navigation spans just
      // the Quick Play card and the quit button — the hidden Server
      // Browser / Host a Match slots are skipped so a controller user
      // can't land on (and trigger) them mid-search. The connected state
      // (in a server) collapses the menu the same way: one Leave Server
      // slot + the quit button.
      if (quickPlay || inServer) {
        if (direction === 'right') return currentIndex < firstCardIdx ? firstCardIdx : quitIdx
        if (direction === 'left') return currentIndex > firstCardIdx ? firstCardIdx : currentIndex
        return currentIndex
      }
      if (currentIndex < firstCardIdx) return direction === 'right' ? firstCardIdx : currentIndex
      if (direction === 'left') return Math.max(firstCardIdx, currentIndex - 1)
      if (direction === 'right') return Math.min(quitIdx, currentIndex + 1)
      return currentIndex
    },
    enabled: !isEntering && !isLeaving && !isQuitModalOpen && !session?.join && !moddingErrorOpen && !interfaceModalOpen && !leaveConfirmOpen && !noMatchModal && !installError && !installModalOpen && !uninstallConfirmOpen && !tutorialOpen,
    bumpersOnly: isInSubView,
    onConfirm: (index, source) => {
      setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
      if (index < tabs.length) {
        handleTabClick(tabs[index])
      } else if (activeHeaderTab === 'Play' && index <= lastCardIdx) {
        // While matchmaking only the Quick Play card renders — map any
        // stale card-slot index to it so Enter can never fire a hidden
        // subview's handler mid-search. While connected the single slot is
        // the Leave Server button (through the confirmation).
        if (inServer) {
          handleRequestLeaveServer()
          return
        }
        const cardName = quickPlay ? 'Quick Play' : cardKeysWithInstall[index - firstCardIdx]
        handleCardClick(cardName, source)
        setHoveredCard(cardName)
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
      return tabs[nextTabIndex] === 'Play' ? firstCardIdx : nextTabIndex
    },
    onControllerActivity: () => setInputMode('controller'),
    onMove: (index) => {
      setInputMode('controller')
      handleHover()
      if (activeHeaderTab === 'Play' && index >= firstCardIdx && index <= lastCardIdx) {
        const cardName = cardKeysWithInstall[index - firstCardIdx]
        // Replay the divider's slide-down whenever focus first lands on the
        // Launch Game card (not on every held-stick repeat tick).
        if (cardName === INSTALL_CARD && hoveredCard !== INSTALL_CARD) {
          setInstallDividerKey((key) => key + 1)
        }
        setHoveredCard(cardName)
      }
    },
    // R key (keyboard) / Y / Triangle (gamepad) — opens the Uninstall flow
    // from the Launch Game card while it is hovered / focused and no modal
    // is in the way.
    onAuxAction: (action, source) => {
      if (action !== 'uninstall') return
      if (!installGame.installed) return
      if (hoveredCard !== INSTALL_CARD) return
      if (activeHeaderTab !== 'Play' || playView !== 'menu') return
      if (isEntering || isLeaving || isQuitModalOpen || installModalOpen || installError || session?.join || moddingErrorOpen || interfaceModalOpen || leaveConfirmOpen || noMatchModal) return
      setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
      handleUninstallClick()
    },
  })

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
  const getCardInfo = (cardName) => {
    if (cardName === INSTALL_CARD) {
      return {
        title: installGame.installed ? t('play.launchgame') : installGame.busy ? t('play.installing') : t('play.install'),
        subtitle: installGame.installed
          ? t('play.launchgame.sub')
          : installGame.busy
            ? t('play.installing.sub')
            : t('play.install.sub'),
      }
    }
    if (cardName === 'Quick Play') {
      return { title: t('play.quickplay'), subtitle: t('play.quickplay.sub') }
    }
    if (cardName === 'Server Browser') {
      return { title: t('play.serverbrowser'), subtitle: t('play.serverbrowser.sub') }
    }
    if (cardName === 'Host a Match') {
      return { title: t('play.hostmatch'), subtitle: t('play.hostmatch.sub') }
    }
    return cardDetails[cardName] || cardDetails['Quick Play']
  }
  const activeInfo = getCardInfo(hoveredCard)

  return (
    <div className={`jupiter-interface-container wallpaper-${mod} ${mod === 'iw8' ? 'content-iw8' : ''} ${isEntering ? 'is-entering' : ''} ${isLeaving ? 'is-leaving' : ''} ${isZombiesMode ? 'zombies-mode' : ''}`} style={zombiesAccentOverride} onMouseMove={handleMouseMove}>
      {/* Top Header Bar */}
      <header className="jupiter-header">
        {/* Logo Left — with IW8 content the logo swaps to IW8's (the Jupiter
            shell stays, per Options > Dynamic Interfaces). The logo class
            follows the ASSET (not the shell) — each header sizes both assets
            for its own context in styles.css. */}
        <div className="jupiter-logo">
          <img src={isJupiterContent ? modeLogo : iw8Logo} alt={isJupiterContent ? modeAlt : 'Warzone 1'} className={isJupiterContent ? (isZombiesMode ? 'header-logo-img-jup header-logo-img-jup-zombies' : 'header-logo-img-jup') : 'header-logo-img-iw8'} />
        </div>

        {/* Centered Navigation Tabs */}
        <nav className="jupiter-header-tabs-centered">
          {tabs.map((tab) => {
            const tabIndex = tabs.indexOf(tab)
            const isControllerFocused = inputMode === 'controller' && focusedControllerIndex === tabIndex
            return (
              <button
                key={tab}
                className={`jupiter-tab-btn ${activeHeaderTab === tab ? 'active' : ''} ${isControllerFocused ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={() => handleTabClick(tab)}
              >
                {t('tab.' + tab.toLowerCase())}
              </button>
            )
          })}
        </nav>

        {/* Top Right Utility Bar (User Chip) */}
        <div className="jupiter-header-right-tools">
          {user && (
            <button
              type="button"
              className="jupiter-user-chip"
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
      </header>

      {/* Main Content Area */}
      <main className="jupiter-main-body">
        <div key={`${activeHeaderTab}-${playView}`} className="tab-slide-container">
          {activeHeaderTab === 'Play' && playView === 'browser' && !inServer && (
            <ServerBrowser theme="jupiter" mod={mod} initialInputMode={inputMode} onBack={handleBackToMenu} gameMode={gameMode} />
          )}

          {activeHeaderTab === 'Play' && playView === 'host' && !inServer && (
            <HostMatch theme="jupiter" mod={mod} initialInputMode={inputMode} onBack={handleBackToMenu} gameMode={gameMode} />
          )}

          {activeHeaderTab === 'Play' && playView === 'menu' && (
            <>
              {/* While connected the in-game panel renders its OWN topline
                  (like the Server Browser) — the headline only shows for
                  the card menu. */}
              {!inServer && (
                <div className="jupiter-active-headline-lowered">
                  <h1>{activeInfo.title}</h1>
                  <p>{activeInfo.subtitle}</p>
                </div>
              )}

              {inServer ? (
                <ConnectedServerPanel
                  theme="jupiter"
                  lobby={currentLobby}
                  players={session?.lobbyMembers || []}
                  partyMembers={session?.partyMembers || []}
                  onLeaveServer={handleRequestLeaveServer}
                />
              ) : (
                <div className="jupiter-cards-row">
                {cardKeysWithInstall.map((cardName, cardIndex) => {
                  // While a Quick Play flow is active (searching or the
                  // found countdown) the other two tiles disappear — only
                  // the Quick Play card stays, wearing the is-quickplay-active
                  // pulse until a lobby is found (then the decal restores,
                  // the pulse continues through the 3s auto-join countdown).
                  if (quickPlay && cardName !== 'Quick Play') return null
                  // The Install & Play tile is dynamic — same artwork-card
                  // look as the others, but its title follows install state.
                  if (cardName === INSTALL_CARD) {
                    const isControllerFocused = inputMode === 'controller' && focusedControllerIndex === firstCardIdx + cardIndex
                    const cardLabel = installGame.installed
                      ? t('play.launchgame')
                      : installGame.busy
                        ? t('play.installing')
                        : t('play.installbtn')
                    const cardImage = installGame.installed ? jupPlayImg : jupInstallImg
                    const cardImageAlt = installGame.installed
                      ? 'Launch Game — start the installed Jupiter game'
                      : installGame.busy
                        ? 'Installing — tap to view progress'
                        : 'Install — download + install the Jupiter game'
                    const showDivider = installGame.installed
                    return (
                      <div
                        key={cardName}
                        className={`jupiter-card-wrapper ${isControllerFocused ? 'controller-focused' : ''}`}
                        onMouseEnter={() => handleCardMouseEnter(cardName)}
                        onClick={() => handleCardClick(cardName)}
                      >
                        <div className="jupiter-card">
                          <img
                            src={cardImage}
                            alt={cardImageAlt}
                            className="jupiter-card-image"
                            draggable="false"
                          />
                          <div className="jupiter-card-title">{cardLabel}</div>
                        </div>
                        <div className={`jupiter-card-select-bar-below ${isControllerFocused ? 'bar-controller-darken' : ''}`}>
                          <span className="bar-select-label">
                            {inputMode === 'controller' && <img className="glyph-img bar-glyph-img" src={glyphSrc(glyphPlatform, 'confirm')} alt="" aria-hidden="true" />}
                            {t('play.select')}
                          </span>
                          {showDivider && <div key={installDividerKey} className="bar-center-divider" />}
                          {showDivider && (
                            <span
                              className="bar-uninstall-section"
                              onClick={handleUninstallClick}
                              onMouseEnter={() => playSound('jupHover')}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleUninstallClick(e) }}
                            >
                              <span className="bar-uninstall-label">{t('play.uninstall')}</span>
                              {inputMode === 'controller' && <img className="glyph-img bar-glyph-img" src={glyphSrc(glyphPlatform, 'uninstall')} alt="" aria-hidden="true" />}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  }
                  const card = cardDetails[cardName]
                  // True during the searching phase — drives the image morph
                  // (jup_quick.jpg crossfades into jup_searching.png via the
                  // stacked .jupiter-card-image-quick / -searching layers)
                  // and the searching decal's breathing pulse.
                  const isSearching = quickPlay?.phase === 'searching'
                  const isControllerFocused2 = inputMode === 'controller' && focusedControllerIndex === firstCardIdx + cardIndex
                  return (
                    <div
                      key={cardName}
                      className={`jupiter-card-wrapper ${quickPlay ? 'is-quickplay-active' : ''} ${isControllerFocused2 ? 'controller-focused' : ''}`}
                      onMouseEnter={() => handleCardMouseEnter(cardName)}
                      onClick={() => handleCardClick(cardName)}
                    >
                      <div className={`jupiter-card ${isSearching ? 'is-quickplay-searching' : ''} ${quickPlay?.phase === 'found' ? 'is-quickplay-found' : ''}`}>
                        <img
                          src={card.image}
                          alt={card.imageAlt}
                          className="jupiter-card-image jupiter-card-image-quick"
                          draggable="false"
                          aria-hidden={isSearching || quickPlay?.phase === 'found'}
                        />
                        {/* Searching decal — a second stacked layer that
                            morphs (crossfades) in over the quick artwork
                            while searching, then fades back out when a
                            lobby is found or the flow is cancelled. */}
                        {cardName === 'Quick Play' && (
                          <img
                            src={jupSearchingImg}
                            alt="Quick Play — searching for a match"
                            className="jupiter-card-image jupiter-card-image-searching"
                            draggable="false"
                            aria-hidden={!isSearching}
                          />
                        )}
                        {/* Found decal — a third stacked layer that morphs
                            (crossfades) in over the quick artwork the
                            moment a lobby is found, staying up through the
                            3s auto-join countdown (quick_play_found.jpg),
                            then fades back out when the join flow takes
                            over or the countdown is cancelled. */}
                        {cardName === 'Quick Play' && (
                          <img
                            src={jupFoundImg}
                            alt="Quick Play — match found"
                            className="jupiter-card-image jupiter-card-image-found"
                            draggable="false"
                            aria-hidden={quickPlay?.phase !== 'found'}
                          />
                        )}
                        {/* Found-phase countdown: a pill overlaid on the
                            tile while the 3s auto-join countdown runs. */}
                        {quickPlay?.phase === 'found' && (
                          <div className="jupiter-card-quickplay-countdown" role="status">
                            JOINING IN <span>{quickPlay.countdown}</span>
                          </div>
                        )}
                        {!card.icon && <div className="jupiter-card-title">{cardName === 'Quick Play' ? t('play.quickplay') : cardName === 'Server Browser' ? t('play.serverbrowser') : cardName === 'Host a Match' ? t('play.hostmatch') : cardName}</div>}
                      </div>
                      {/* The Quick Play badge lives OUTSIDE .jupiter-card: the
                          enlarged emblem mostly floats above the tile, and the
                          card's overflow:hidden would clip anything sticking
                          out. The wrapper (position:relative) is its anchor. */}
                      {card.icon && (
                        <div className="jupiter-card-badge">
                          <img src={card.icon} alt="" className="jupiter-card-badge-icon" draggable="false" />
                          <span className="jupiter-card-badge-text">{t('play.quickplay')}</span>
                        </div>
                      )}
                      <div className={`jupiter-card-select-bar-below ${isControllerFocused2 ? 'bar-controller-darken' : ''}`}>
                        <span className="bar-select-label">
                          {inputMode === 'controller' && <img className="glyph-img bar-glyph-img" src={glyphSrc(glyphPlatform, 'confirm')} alt="" aria-hidden="true" />}
                          {t('play.select')}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
              )}

              {/* No Quick Play status panel — the tile's is-quickplay-active
                  pulse is the search indicator (plus the JOINING IN n pill
                  during the found countdown). The minute-elapsed case is a
                  modal (JupiterQuickPlayModal). */}
            </>
          )}

          {activeHeaderTab === 'Account' && <AccountTab theme="jupiter" />}
          {activeHeaderTab === 'Social' && (
            <SocialTab
              theme="jupiter"
              onSwitchToAccount={() => handleTabClick('Account')}
            />
          )}
          {activeHeaderTab === 'RTM' && isJupiterContent && <ModdingTab theme="jupiter" onModalChange={setModdingErrorOpen} />}
          {activeHeaderTab === 'Help' && <HelpTab theme="jupiter" mod={mod} />}
          {activeHeaderTab === 'Options' && <OptionsTab theme="jupiter" onModalChange={setInterfaceModalOpen} onRetakeTutorial={handleRetakeTutorial} />}
        </div>
      </main>

      {/* Right-side player roster HUD — everyone in the joined lobby
          (party members tagged PARTY) or the party squad when not in a
          lobby, with a LEAVE SERVER button while connected. Pinned below
          the header's user chip; persists across tabs. Renders nothing
          for IW8 content (no session provider). */}
      <PlayerRoster theme="jupiter" />

      {/* Top Left Quit Trigger (back arrow) */}
      <div className="jupiter-quit-btn-wrapper">
        <button
          className={`jupiter-quit-btn ${inputMode === 'controller' && focusedControllerIndex === focusedQuitIdx ? 'controller-focused' : ''}`}
          onMouseEnter={handleHover}
          onClick={handleQuitArrowClick}
          aria-label={isInSubView ? 'Back to main menu' : activeHeaderTab !== 'Play' ? 'Back to Play tab' : 'Quit to Desktop'}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      {/* Bottom Left Controller Hint — platform glyph next to Select */}
      {inputMode === 'controller' && (
        <div className="jupiter-controller-hint-bar" aria-label="Controller controls">
          <span className="jupiter-controller-hint">
            <img className="glyph-img hint-glyph-img" src={glyphSrc(glyphPlatform, 'confirm')} alt="" aria-hidden="true" />
            Select
          </span>
        </div>
      )}

      <JupiterQuitModal
        isOpen={isQuitModalOpen}
        onClose={() => setIsQuitModalOpen(false)}
        onGoLauncher={onGoLauncher}
        onQuitDesktop={handleQuitDesktop}
      />

      <LeaveServerConfirmModal
        theme="jupiter"
        isOpen={leaveConfirmOpen}
        onConfirm={() => void handleLeaveServer()}
        onCancel={() => setLeaveConfirmOpen(false)}
      />

      <JupiterQuickPlayModal
        isOpen={Boolean(noMatchModal)}
        message={noMatchModal}
        onSearchAgain={handleNoMatchSearchAgain}
        onCancel={handleNoMatchCancel}
      />

      <JupiterInstallModal
        theme="jupiter"
        isOpen={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        installPath={settings?.game_install_path || ''}
        onPathChange={(path) => setSetting('game_install_path', path)}
        installState={installGame}
        onError={(message) => setInstallError(message)}
      />

      <JupiterErrorModal
        theme="jupiter"
        isOpen={Boolean(installError)}
        title="GAME INSTALL FAILED"
        message={installError}
        onClose={() => setInstallError(null)}
      />

      <GameUninstallModal
        theme="jupiter"
        isOpen={uninstallConfirmOpen}
        onConfirm={handleUninstallConfirm}
        onCancel={() => setUninstallConfirmOpen(false)}
        installPath={settings?.game_install_path || ''}
      />

      <AuthRequiredNotice
        theme="jupiter"
        entranceActive={isEntering || isLeaving}
        onSwitchToAccount={() => handleTabClick('Account')}
      />

      <TutorialOverlay
        isOpen={tutorialOpen}
        theme="jupiter"
        onClose={handleTutorialClose}
      />
    </div>
  )
}


