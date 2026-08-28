import React, { useState } from 'react'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { openExternal } from '../utils/openExternal'
import { useTranslation } from '../utils/i18n'

// Community Discord servers.
const DISCORD_SERVERS = [
  {
    name: 'Hina Warzone Mods Discord',
    url: 'https://discord.gg/wtNPKvmGt',
    displayUrl: 'discord.gg/wtNPKvmGt',
    note: 'Official Hina Warzone Mods community hub.',
    badge: 'Mod Support',
    highlight: false,
  },
]

// Merged Discord + Help tab. The Discord cards come first, then the
// game-mod support card, and the launcher-help card sits at the BOTTOM of
// everything.
export default function HelpTab({ theme = 'jupiter' }) {
  const { t } = useTranslation()
  const hoverSound = 'jupHover'
  const selectSound = 'jupSelect'
  const [lastOpened, setLastOpened] = useState(null)
  const [inputMode, setInputMode] = useState('mouse')

  const discords = DISCORD_SERVERS

  const handleCardEnter = () => playSound(hoverSound)

  const handleOpen = (disc) => {
    playSound(selectSound)
    setLastOpened(disc.name)
    openExternal(disc.url)
  }

  // Middle-click / aux-click opens silently, mirroring the original
  // `<a target="_blank">` power-user behavior. Skips the select sound and
  // just hands the URL to the browser.
  const handleAuxOpen = (disc) => {
    setLastOpened(disc.name)
    openExternal(disc.url)
  }

  // Each Discord card is one controller slot (big target). The help cards
  // are informational — nothing to navigate to there.
  const focusedIndex = useControllerNavigation({
    itemCount: discords.length,
    allowedDirections: ['up', 'down'],
    onControllerActivity: () => setInputMode('controller'),
    onMove: (index) => {
      setInputMode('controller')
      playSound(hoverSound)
    },
    onConfirm: (index, source) => {
      setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
      const disc = discords[index]
      if (disc) handleOpen(disc)
    },
  })

  const isFocused = (index) => inputMode === 'controller' && focusedIndex === index

  return (
    <div className={`tab-content-panel ${'jupiter-theme'}`}>
      <div className="tab-header-title">
        <h2>{t('help.title')}</h2>

      </div>

      <div className="help-sections" onMouseLeave={() => setLastOpened(null)}>
        {discords.length > 0 && (
          <>
            <div className="help-section-kicker">{t('help.discords')}</div>
            {discords.map((disc, index) => (
              <div
                key={disc.name}
                role="button"
                tabIndex={0}
                className={`discord-card ${disc.highlight ? 'highlight-card' : ''} ${isFocused(index) ? 'controller-focused' : ''}`}
                onMouseEnter={handleCardEnter}
                onClick={() => handleOpen(disc)}
                onAuxClick={() => handleAuxOpen(disc)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') handleOpen(disc)
                }}
              >
                <div className="discord-card-top">
                  <h3>{disc.name}</h3>
                  <span className="discord-badge">{disc.badge}</span>
                </div>
                <p className="discord-note">{disc.note}</p>
                <span className="discord-link-btn" aria-hidden="true">
                  {lastOpened === disc.name ? t('help.opening') : (
                    <>{t('help.joinserver')} ({disc.displayUrl}) &#8599;</>
                  )}
                </span>
              </div>
            ))}
          </>
        )}

        <div className="help-card">
          <h3>🎮 {t('help.gamemod.support')} (Hina WZ Mod)</h3>
          <p>
            Support for the Hina WZ Mod {t('help.gamemod.best')} the Hina Warzone Mods Discord.
          </p>
          <div className="help-tip-box">
            <span>💡 <strong>{t('help.gamemod.protip')}</strong> {t('help.gamemod.protip.desc')}</span>
          </div>
        </div>

        {/* Launcher-help card — deliberately LAST: help with this LFG tool
            sits at the bottom of everything on the tab. */}
        <div className="help-card highlight-card">
          <h3>🛠️ {t('help.launcher.support')}</h3>
          <p>
            {t('help.launcher.desc')}
          </p>
          <div className="contact-box">
            <span className="contact-label">{t('help.launcher.contact')}</span>
            <span className="contact-tag">beanstalk313_16060</span>
          </div>
        </div>
      </div>
    </div>
  )
}
