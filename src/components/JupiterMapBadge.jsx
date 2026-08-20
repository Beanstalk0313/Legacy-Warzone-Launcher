import React from 'react'
import jupRebirth from '../assets/jup_rebirth.png'
import jupRebirthEvil from '../assets/jup_rebirth_evil.png'
import jupFortune from '../assets/jup_fortune.png'
import jupVondel from '../assets/jup_vondel.png'
import jupVondelNight from '../assets/jup_vondel_night.png'
import jupUrzikstan from '../assets/jup_urzikstan.png'

// Bottom-right HUD badge showing the CURRENT MAP while a Jupiter lobby is
// active — rendered by JupiterSessionProvider once a join reaches the
// 'result' stage (connected), and by HostMatch's LOBBY CONTROL dashboard
// while hosting. Jupiter content only: the six Jupiter maps each have a
// dedicated artwork asset; any other map (e.g. IW8 maps) simply renders
// nothing.
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

  // `theme` is the SHELL style: an IW8 shell (Dynamic Interfaces) wears the
  // red accent + square corners and lifts clear of the bottom-right Quit
  // button — see .jupiter-map-badge.iw8-styled in styles.css.
  const isJupiter = theme === 'jupiter'

  // Text block sits LEFT of the artwork: [CURRENT MAP / map name / mode] [image].
  return (
    <div className={`jupiter-map-badge ${isJupiter ? '' : 'iw8-styled'}`}>
      <div className="jupiter-map-badge-text">
        <span className="jupiter-map-badge-label">CURRENT MAP</span>
        <strong>{map}</strong>
        {mode && <em>{mode}</em>}
      </div>
      <img src={art} alt="" className="jupiter-map-badge-img" draggable="false" />
    </div>
  )
}
