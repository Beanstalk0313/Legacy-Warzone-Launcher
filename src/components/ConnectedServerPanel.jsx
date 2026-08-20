import React from 'react'
import { playSound } from '../utils/audio'

// Play-tab panel shown while connected to a server: the connected lobby's
// name + current map/mode and a Leave Server button. While connected the
// Quick Play / Server Browser / Host a Match cards are hidden and this
// panel takes their place — the player is in-game, so the menu only offers
// leaving (or switching to another tab).
export default function ConnectedServerPanel({ theme = 'jupiter', lobby, onLeaveServer }) {
  const isJupiter = theme === 'jupiter'
  const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'
  const handleHover = () => playSound(hoverSound)

  if (!lobby) return null

  return (
    <div className={`connected-server-panel ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
      <span className="connected-server-kicker">CONNECTED</span>
      <h3 className="connected-server-name">{lobby.name}</h3>
      <p className="connected-server-map">{lobby.map} · {lobby.mode}</p>
      <p className="connected-server-hint">You're in game — you can switch tabs, but the server list and hosting are hidden until you leave.</p>
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
  )
}
