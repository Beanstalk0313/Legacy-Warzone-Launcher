import React, { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { playSound } from "../utils/audio"
import { useTranslation } from "../utils/i18n"

// One key per user so the tutorial re-plays if a different account signs in.
export function getTutorialKey(userId) {
  return `lwz-tutorial-seen-${userId}`
}

export function markTutorialSeen(userId) {
  try { localStorage.setItem(getTutorialKey(userId), "1") } catch { /* nothing */ }
}

export function hasTutorialBeenSeen(userId) {
  try { return localStorage.getItem(getTutorialKey(userId)) === "1" } catch { return false }
}

export function resetTutorialSeen(userId) {
  try { localStorage.removeItem(getTutorialKey(userId)) } catch { /* nothing */ }
}

const JUPITER_STEPS = [
  {
    title: "Welcome to the Legacy Modern Warfare III Launcher",
    body: "This quick tour will walk you through everything the Warzone III (Jupiter Mod) launcher has to offer.\n\nPress Next to continue, or Skip to jump straight in.",
    anchor: null,
    arrowDir: null,
  },
  {
    title: "The Play Menu",
    body: "This is your main menu. Three tiles let you get into a match:\n\nQuick Play — auto-finds and joins an open lobby.\nServer Browser — browse and pick a server manually.\nHost a Match — create and run your own lobby.",
    anchor: ".jupiter-cards-row",
    arrowDir: "down",
    spotlightPad: 20,
  },
  {
    title: "Quick Play",
    body: "Click the Quick Play tile and the launcher searches for an open lobby for up to 60 seconds. When one is found, a 3-second countdown starts and you auto-join.\n\nIf nothing is found within the minute, a dialog lets you search again.",
    anchor: ".jupiter-cards-row .jupiter-card-wrapper:first-child",
    arrowDir: "down",
    spotlightPad: 16,
  },
  {
    title: "Server Browser",
    body: "Browse all public Warzone III lobbies in real time. Filter by region or search by name.\n\nClicking a lobby starts the guided join flow — the launcher handles every RTM step automatically.",
    anchor: ".jupiter-cards-row .jupiter-card-wrapper:nth-child(2)",
    arrowDir: "down",
    spotlightPad: 16,
  },
  {
    title: "Host a Match",
    body: "Create your own Warzone III lobby and share it with others. After setup you get a live Lobby Control dashboard — change map, mode, and view who's in your server in real time.",
    anchor: ".jupiter-cards-row .jupiter-card-wrapper:nth-child(3)",
    arrowDir: "down",
    spotlightPad: 16,
  },
  {
    title: "Header Navigation",
    body: "These tabs switch between the launcher's main sections:\n\nPlay — the menu you're on now.\nRTM — Jupiter Mod automation tools.\nAccount — your profile and gamertag.\nSocial — friends and parties.\nHelp — Discord servers and support.\nOptions — launcher settings.\n\nOn a controller, use the bumpers (LB / RB) to switch tabs.",
    anchor: ".jupiter-header-tabs-centered",
    arrowDir: "up",
    spotlightPad: 14,
  },
  {
    title: "RTM — Modding Tools",
    body: "The RTM tab is Jupiter-exclusive. From here you can:\n\nSave and load game data.\nSwitch between Warzone and Zombies mode.\nChange your in-game username.\nFix the loadout display bug.\nEdit loadouts and operators with guided flows.\n\nThe launcher writes trigger files that the mod reads automatically.",
    anchor: ".jupiter-header-tabs-centered .jupiter-tab-btn:nth-child(2)",
    arrowDir: "up",
    spotlightPad: 14,
  },
  {
    title: "Account Tab",
    body: "Manage your gamertag, Discord username, and region here.\n\nYour gamertag is used to identify you to other players in shared lobbies.",
    anchor: ".jupiter-header-tabs-centered .jupiter-tab-btn:nth-child(3)",
    arrowDir: "up",
    spotlightPad: 14,
  },
  {
    title: "Social Tab",
    body: "Add friends by gamertag, form or join a party, and accept invites.\n\nWhen your party leader joins a server, you're automatically pulled in. Right-click a friend to set a nickname, invite them to your party, or remove them.",
    anchor: ".jupiter-header-tabs-centered .jupiter-tab-btn:nth-child(4)",
    arrowDir: "up",
    spotlightPad: 14,
  },
  {
    title: "Help Tab",
    body: "Find community Discord servers and support resources here.\n\nThe Hina Warzone Mods server is the most active for help — the launcher developer is in there regularly.",
    anchor: ".jupiter-header-tabs-centered .jupiter-tab-btn:nth-child(5)",
    arrowDir: "up",
    spotlightPad: 14,
  },
  {
    title: "Options Tab",
    body: "Customize your launcher:\n\nSound — Silent Mode and Dynamic Sound Effects.\nInterface — force a different UI skin with Dynamic Interfaces.\nDisplay — fullscreen mode and monitor selection.\nDeveloper — testing server and advanced RTM tools.\n\nSettings save automatically.",
    anchor: ".jupiter-header-tabs-centered .jupiter-tab-btn:last-child",
    arrowDir: "up",
    spotlightPad: 14,
  },
  {
    title: "The Back / Quit Arrow",
    body: "The arrow in the top-left is context-aware:\n\nInside Server Browser or Host a Match — returns to the Play menu.\nOn any non-Play tab — jumps back to the Play tab.\nOn the Play tab — opens the Quit to Desktop dialog.\n\nOn a controller, the B button does the same thing.",
    anchor: ".jupiter-quit-btn-wrapper",
    arrowDir: "right",
    spotlightPad: 14,
  },
  {
    title: "You're All Set!",
    body: "That's the full tour of the Warzone III launcher. Good luck out there — see you on the battlefield.",
    anchor: null,
    arrowDir: null,
  },
]

function getAnchorRect(selector, pad) {
  if (!selector) return null
  const el = document.querySelector(selector)
  if (!el) return null
  const canvas = document.querySelector(".ui-canvas")
  if (!canvas) return null
  const elRect = el.getBoundingClientRect()
  const canvasRect = canvas.getBoundingClientRect()
  const scaleX = 2560 / canvasRect.width
  const scaleY = 1440 / canvasRect.height
  return {
    x: (elRect.left - canvasRect.left) * scaleX - pad,
    y: (elRect.top - canvasRect.top) * scaleY - pad,
    w: elRect.width * scaleX + pad * 2,
    h: elRect.height * scaleY + pad * 2,
  }
}

function ArrowIndicator({ direction }) {
  if (!direction) return null
  const rotations = { up: 0, right: 90, down: 180, left: 270 }
  return (
    <div className="tutorial-arrow" style={{ transform: `rotate(${rotations[direction] ?? 0}deg)` }} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="19" x2="12" y2="5" />
        <polyline points="5 12 12 5 19 12" />
      </svg>
    </div>
  )
}

export default function TutorialOverlay({ isOpen, theme = "jupiter", onClose }) {
  const { t } = useTranslation()
  const steps = JUPITER_STEPS
  const hoverSound = "jupHover"
  const selectSound = "jupSelect"

  const [stepIndex, setStepIndex] = useState(0)
  const [spotRect, setSpotRect] = useState(null)
  const [cardPos, setCardPos] = useState(null)
  const stepRef = useRef(stepIndex)
  stepRef.current = stepIndex

  const step = steps[stepIndex] ?? steps[steps.length - 1]
  const isFirst = stepIndex === 0
  const isLast = stepIndex === steps.length - 1

  const recalc = useCallback(() => {
    const s = steps[stepRef.current]
    if (!s) return
    const pad = s.spotlightPad ?? 12
    const rect = getAnchorRect(s.anchor, pad)
    setSpotRect(rect)
    if (!rect) { setCardPos(null); return }

    const margin = 40
    const cardW = 520
    const cardH = 360
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    let cx2 = cx - cardW / 2
    let cy2

    if (s.arrowDir === "down") cy2 = rect.y - cardH - 56
    else if (s.arrowDir === "up") cy2 = rect.y + rect.h + 56
    else if (s.arrowDir === "right") { cx2 = rect.x - cardW - 56; cy2 = cy - cardH / 2 }
    else if (s.arrowDir === "left") { cx2 = rect.x + rect.w + 56; cy2 = cy - cardH / 2 }
    else cy2 = rect.y + rect.h + 56

    cx2 = Math.max(margin, Math.min(2560 - cardW - margin, cx2))
    cy2 = Math.max(margin, Math.min(1440 - cardH - margin, cy2))
    setCardPos({ x: cx2, y: cy2 })
  }, [steps])

  useEffect(() => {
    if (!isOpen) return undefined
    const id = window.setTimeout(recalc, 90)
    return () => window.clearTimeout(id)
  }, [isOpen, stepIndex, recalc])

  const handleNext = useCallback(() => {
    playSound(selectSound)
    setStepIndex((i) => {
      const next = i + 1
      if (next >= steps.length) { onClose?.(); return i }
      return next
    })
  }, [selectSound, steps.length, onClose])

  const handlePrev = useCallback(() => {
    playSound(hoverSound)
    setStepIndex((i) => Math.max(0, i - 1))
  }, [hoverSound])

  const handleSkip = useCallback(() => {
    playSound(selectSound)
    onClose?.()
  }, [selectSound, onClose])

  useEffect(() => {
    if (!isOpen) return undefined
    const onKey = (e) => {
      if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") { e.preventDefault(); handleNext() }
      else if (e.key === "ArrowLeft") { e.preventDefault(); handlePrev() }
      else if (e.key === "Escape") { e.preventDefault(); handleSkip() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isOpen, handleNext, handlePrev, handleSkip])

  useEffect(() => { if (isOpen) setStepIndex(0) }, [isOpen])

  if (!isOpen) return null

  const prefix = "jupiter"
  const svgSpot = spotRect
    ? `M${spotRect.x},${spotRect.y} h${spotRect.w} v${spotRect.h} h-${spotRect.w} Z`
    : ""

  const cardStyle = cardPos
    ? { position: "absolute", left: `${(cardPos.x / 2560) * 100}%`, top: `${(cardPos.y / 1440) * 100}%` }
    : { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)" }

  return createPortal(
    <div className={`tutorial-overlay ${prefix}-tutorial`} role="dialog" aria-modal="true" aria-label="Launcher Tutorial">
      {spotRect ? (
        <svg className="tutorial-spotlight-svg" viewBox="0 0 2560 1440" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <clipPath id="tutorial-clip">
              <path fillRule="evenodd" d={`M0,0 h2560 v1440 h-2560 Z ${svgSpot}`} />
            </clipPath>
          </defs>
          <rect x="0" y="0" width="2560" height="1440" fill="rgba(0,0,0,0.82)" clipPath="url(#tutorial-clip)" />
          <rect
            x={spotRect.x} y={spotRect.y} width={spotRect.w} height={spotRect.h}
            fill="none"
            stroke="rgba(2,143,204,0.9)"
            strokeWidth="2" rx="2"
          />
        </svg>
      ) : (
        <div className="tutorial-dim-full" aria-hidden="true" />
      )}

      <div className={`tutorial-card ${prefix}-tutorial-card`} style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div className={`tutorial-accent-bar ${prefix}-tutorial-accent`} />
        <div className="tutorial-card-body">
          <span className="tutorial-step-counter">{stepIndex + 1} / {steps.length}</span>
          <h2 className="tutorial-title">{stepTitle}</h2>
          <div className="tutorial-body">
            {stepBody.split("\n").map((line, i) =>
              line.trim() === "" ? <br key={i} /> : <p key={i}>{line}</p>
            )}
          </div>
          <div className="tutorial-actions">
            {!isFirst && (
              <button type="button" className={`tutorial-btn tutorial-btn-secondary ${prefix}-tutorial-btn-secondary`}
                onMouseEnter={() => playSound(hoverSound)} onClick={handlePrev}>
                {t('tut.back')}
              </button>
            )}
            <button type="button" className={`tutorial-btn tutorial-btn-skip ${prefix}-tutorial-btn-skip`}
              onMouseEnter={() => playSound(hoverSound)} onClick={handleSkip}>
              {isLast ? t('tut.close') : t('tut.skip')}
            </button>
            {!isLast ? (
              <button type="button" className={`tutorial-btn tutorial-btn-primary ${prefix}-tutorial-btn-primary`}
                onMouseEnter={() => playSound(hoverSound)} onClick={handleNext}>
                {t('tut.next')}
              </button>
            ) : (
              <button type="button" className={`tutorial-btn tutorial-btn-primary ${prefix}-tutorial-btn-primary`}
                onMouseEnter={() => playSound(hoverSound)} onClick={handleSkip}>
                {t('tut.start')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.getElementById("ui-portal-root") || document.body,
  )
}
