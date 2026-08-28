import React from 'react'
import jupRebirth from '../assets/rebirth.png'
import jupRebirthEvil from '../assets/rebirth_evil.png'
import jupFortune from '../assets/fortune.png'
import jupVondel from '../assets/vondel.png'
import jupVondelNight from '../assets/vondel_night.png'
import jupUrzikstan from '../assets/urzikstan.png'

// Bottom-right HUD badge showing the CURRENT MAP while a lobby is
// active — rendered by JupiterSessionProvider once a join reaches the
// 'result' stage (connected), and by HostMatch's LOBBY CONTROL dashboard
// while hosting. The six maps each have a dedicated artwork asset; any
// other map simply renders nothing.
const MAP_ART = {
  'Rebirth Island': jupRebirth,
  Hellspawn: jupRebirthEvil,
  "Fortune's Keep": jupFortune,
  Vondel: jupVondel,
  'Vondel Night': jupVondelNight,
  Urzikstan: jupUrzikstan,
}

export default function JupiterMapBadge({ map, mode, theme = 'jupiter' }) {
  const art = MAP_ART[map]
  if (!art) return null

  // `theme` selects the styled variant in styles.css.
  const isJupiter = theme === 'jupiter'

  // Text block sits LEFT of the artwork: [CURRENT MAP / map name / mode] [image].
  return (
    <div className="jupiter-map-badge">
      <div className="jupiter-map-badge-text">
        <span className="jupiter-map-badge-label">CURRENT MAP</span>
        <strong>{map}</strong>
        {mode && <em>{mode}</em>}
      </div>
      <img src={art} alt="" className="jupiter-map-badge-img" draggable="false" />
    </div>
  )
}
