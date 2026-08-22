import React from 'react'
import { playSound } from '../utils/audio'
import JupiterMapBadge from './JupiterMapBadge'

// Connected-state panel (Play menu): replaces the Quick Play / Server
// Browser / Host a Match cards while the player is in a server. Uses the
// SAME section design as the Server Browser — topline + list rows:
//   • topline: kicker + CONNECTED h1 + description, with the LEAVE SERVER
//     button on the right (the browser's action-button slot)
//   • IN THE GAME — the live player roster (EVERYONE in the lobby from
//     server_members, with PARTY tags on party members) as full-width
//     browser rows
//   • the CURRENT MAP badge pinned beneath the roster (same section as the
//     host's LOBBY CONTROL dashboard)
// The right-side PlayerRoster HUD hides while connected — the roster lives
// here now. Leaving always goes through the interface's confirmation modal
// (onLeaveServer requests it; the actual leave runs in the interface).
export default function ConnectedServerPanel({ theme = 'jupiter', lobby, players = [], partyMembers = [], onLeaveServer }) {
  const isJupiter = theme === 'jupiter'
  const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'
  const handleHover = () => playSound(hoverSound)

  if (!lobby) return null

  const partyUserIds = new Set((partyMembers || []).map((member) => member.userId))

  return (
    <section className={`server-browser connected-server-panel ${isJupiter ? 'server-browser-jupiter' : 'server-browser-iw8'}`}>
      <div className="server-browser-topline">
        <div>
          <span className="server-browser-kicker">PLAY / IN GAME</span>
          <h1>CONNECTED</h1>
          <p>You're connected to <strong>{lobby.name}</strong> — the server list and hosting stay hidden until you leave.</p>
        </div>
        <button
          type="button"
          className="connected-server-leave-btn"
          onMouseEnter={handleHover}
          onClick={() => {
            playSound(selectSound)
            onLeaveServer?.()
          }}
        >
          LEAVE SERVER
        </button>
      </div>

      <div className="connected-server-layout">
        <div className="server-browser-list connected-roster-list">
          <div className="connected-lobby-header">
            <span>IN THE GAME</span>
            <strong className="connected-roster-count">{players.length}</strong>
          </div>
          {players.length === 0 && (
            <div className="server-browser-empty connected-roster-empty">No other players in the lobby yet.</div>
          )}
          {players.map((player) => {
            const isParty = partyUserIds.has(player.userId)
            return (
              <div
                key={player.userId || player.name}
                className={`connected-player-row ${player.isGuest ? 'guest' : ''}`}
              >
                <span className="connected-player-avatar">{player.name[0]?.toUpperCase() || '?'}</span>
                <span className="connected-player-name">{player.name}</span>
                {isParty && <span className="player-card-tag player-card-tag-party">PARTY</span>}
                {player.isMe && <span className="player-card-tag player-card-tag-me">YOU</span>}
                {player.isGuest && !isParty && !player.isMe && <span className="host-dashboard-player-tag">GUEST</span>}
              </div>
            )
          })}
        </div>
        <JupiterMapBadge map={lobby.map} mode={lobby.mode} theme={theme} />
      </div>
    </section>
  )
}
