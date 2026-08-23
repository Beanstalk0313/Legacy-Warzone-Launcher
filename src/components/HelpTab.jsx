import React, { useState } from 'react'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { openExternal } from '../utils/openExternal'

// Community Discord servers. Each interface only lists its own mod's cards:
//   Jupiter content → Hina Warzone Mods
//   IW8 content     → IW8 Mod + The 187
// Filtering follows the CONTENT mod (`mod`, not the shell `theme`), so a
// Dynamic Interfaces swap keeps the content's own servers: Jupiter mod under
// an IW8 shell still shows Hina, and IW8 content under a Jupiter shell still
// shows the IW8 / 187 cards.
const DISCORD_SERVERS = [
  {
    name: 'IW8 Mod Discord',
    url: 'https://discord.gg/demonware',
    displayUrl: 'discord.gg/demonware',
    note: 'Note: The IW8 Mod Discord is full of incompetent staff, but it has more people—making it better for LFG.',
    badge: 'LFG Volume',
    highlight: false,
    mods: ['iw8'],
  },
  {
    name: 'The 187 Discord',
    url: 'https://discord.gg/eGqkmJ38d',
    displayUrl: 'discord.gg/eGqkmJ38d',
    note: 'Recommended: The 187 Discord has people that will actually try to help you and are much nicer.',
    badge: 'Helpful Staff & Community',
    highlight: true,
    mods: ['iw8'],
  },
  {
    name: 'Hina Warzone Mods Discord',
    url: 'https://discord.gg/wtNPKvmGt',
    displayUrl: 'discord.gg/wtNPKvmGt',
    note: 'Official Hina Warzone Mods community hub.',
    badge: 'Mod Support',
    highlight: false,
    mods: ['jupiter'],
  },
]

// Merged Discord + Help tab. The Discord cards come first (filtered to the
// content mod), then the game-mod support card, and the launcher-help card
// sits at the BOTTOM of everything.
export default function HelpTab({ theme = 'iw8', mod = theme }) {
  const isJupiter = theme === 'jupiter'
  const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'
  const isJupiterContent = mod === 'jupiter'
  const [lastOpened, setLastOpened] = useState(null)
  const [inputMode, setInputMode] = useState('mouse')

  const discords = DISCORD_SERVERS.filter((disc) => disc.mods.includes(mod))

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
    <div className={`tab-content-panel ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
      <div className="tab-header-title">
        <h2>HELP & SUPPORT</h2>

      </div>

      <div className="help-sections" onMouseLeave={() => setLastOpened(null)}>
        {discords.length > 0 && (
          <>
            <div className="help-section-kicker">COMMUNITY DISCORD SERVERS</div>
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
                  {lastOpened === disc.name ? 'Opening…' : (
                    <>Join Server ({disc.displayUrl}) &#8599;</>
                  )}
                </span>
              </div>
            ))}
          </>
        )}

        <div className="help-card">
          <h3>🎮 Game Mod Support ({isJupiterContent ? 'Hina WZ Mod' : 'IW8 & Hina WZ Mod'})</h3>
          <p>
            Support for the {isJupiterContent ? 'Hina WZ Mod' : 'IW8 Mod or the Hina WZ Mod'} is best asked directly in {isJupiterContent ? 'the Hina Warzone Mods Discord' : 'one of the community Discords'}.
          </p>
          <div className="help-tip-box">
            <span>💡 <strong>Pro Tip:</strong> I'm very active in the <strong>Hina Warzone Mods Discord</strong> server and may be the one who helps you out directly!</span>
          </div>
        </div>

        {/* Launcher-help card — deliberately LAST: help with this LFG tool
            sits at the bottom of everything on the tab. */}
        <div className="help-card highlight-card">
          <h3>🛠️ LFG Tool App Support</h3>
          <p>
            If you need assistance specifically with this LFG tool application or report bugs:
          </p>
          <div className="contact-box">
            <span className="contact-label">Direct Discord Contact:</span>
            <span className="contact-tag">beanstalk313_16060</span>
          </div>
        </div>
      </div>
    </div>
  )
}
