import React from 'react'
import { useAuth } from './AuthProvider'
import { useJupiterSession } from '../utils/jupiterSession'
import { useTranslation } from '../utils/i18n'
import RegionFlag from './RegionFlag'

// Right-side player HUD: the PARTY squad, shown while NOT in a match.
//   • Connected to a server → renders nothing: the live lobby roster now
//     lives inside the in-game (IN LOBBY) panel — ConnectedServerPanel,
//     which mirrors the host's LOBBY CONTROL dashboard (player list +
//     CURRENT MAP badge).
//   • Not in a match but in a party → the party squad, pinned just below
//     the header's user chip on the right edge (persists across tabs).
// Party data comes from JupiterSessionProvider (which owns the party system

// content renders without a provider, so `useJupiterSession()` returns null
// there and nothing shows.
export default function PlayerRoster({ theme = 'jupiter' }) {
  const { t } = useTranslation()
  const session = useJupiterSession()
  const { user } = useAuth()
  const partyMembers = session?.partyMembers || []
  const connected = Boolean(session?.connected)

  // The lobby roster moved into the in-game panel — while connected the
  // right-side HUD is hidden entirely.
  if (connected) return null
  // No party system without an account, and nothing to show without a party.
  if (!user || partyMembers.length === 0) return null

  const isJupiter = theme === 'jupiter'

  return (
    <div className={`player-roster ${'jupiter-theme'}`}>
      <div className="player-roster-title">
        {t('roster.squad')}
        <span className="player-roster-count">{partyMembers.length}</span>
      </div>
      <div className="player-roster-list">
        {partyMembers.map((member) => {
          const isMe = member.userId === user?.id
          return (
            <div
              key={member.userId || member.name}
              className={`player-card ${isMe ? 'is-me' : ''}`}
              title={member.region || member.name}
            >
              <RegionFlag region={member.region} className="player-card-flag" />
              <span className="player-card-name">{member.name}</span>
              {isMe && <span className="player-card-tag player-card-tag-me">{t('roster.you')}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
