import React from 'react'
import { playSound } from '../utils/audio'
import { useAuth } from './AuthProvider'
import { useJupiterSession } from '../utils/jupiterSession'
import RegionFlag from './RegionFlag'

// Right-side player HUD: shows who is in your lobby or party.
//   • Joined a server → EVERYONE in the lobby (server_members, polled by
//     JupiterSessionProvider), with party members tagged PARTY.
//   • Not joined but in a party → the party squad.
// While connected to a server a LEAVE SERVER button sits under the list
// (runs RTM.exe -disconnect + MainMenuOffline and returns to the Play
// menu — see JupiterSessionProvider.leaveServer).
// Rendered at the interface container level (both shells) so it persists
// across tabs — pinned just below the header's user chip on the right edge.
// Party data comes from JupiterSessionProvider (which owns the party system
// and polls `partyMembers` — user_id + name + region per member). IW8
// content renders without a provider, so `useJupiterSession()` returns null
// there and nothing shows.
export default function PlayerRoster({ theme = 'jupiter', onLeaveServer }) {
  const session = useJupiterSession()
  const { user } = useAuth()
  const lobbyMembers = session?.lobbyMembers || []
  const partyMembers = session?.partyMembers || []
  const connected = Boolean(session?.connected)
  const isInLobby = lobbyMembers.length > 0
  const members = isInLobby ? lobbyMembers : partyMembers

  if (members.length === 0 && !connected) return null
  // Guests (not signed in) only ever see the lobby roster — there is no
  // party system without an account.
  if (!user && !isInLobby && !connected) return null

  const partyUserIds = new Set(partyMembers.map((member) => member.userId))
  const isJupiter = theme === 'jupiter'
  const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'

  return (
    <div className={`player-roster ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
      <div className="player-roster-title">
        {isInLobby ? 'IN LOBBY' : connected ? 'CONNECTED' : 'SQUAD'}
        <span className="player-roster-count">{members.length}</span>
      </div>
      <div className="player-roster-list">
        {members.map((member) => {
          const isMe = member.isMe || member.userId === user?.id
          const isParty = partyUserIds.has(member.userId)
          return (
            <div
              key={member.userId || member.name}
              className={`player-card ${isMe ? 'is-me' : ''} ${isParty ? 'is-party' : ''}`}
              title={member.region || member.name}
            >
              <RegionFlag region={member.region} className="player-card-flag" />
              <span className="player-card-name">{member.name}</span>
              {isParty && <span className="player-card-tag player-card-tag-party">PARTY</span>}
              {isMe && <span className="player-card-tag player-card-tag-me">YOU</span>}
            </div>
          )
        })}
      </div>
      {connected && (
        <button
          type="button"
          className="player-roster-leave-btn"
          onMouseEnter={() => playSound(hoverSound)}
          onClick={() => {
            playSound(selectSound)
            onLeaveServer?.()
          }}
        >
          LEAVE SERVER
        </button>
      )}
    </div>
  )
}
