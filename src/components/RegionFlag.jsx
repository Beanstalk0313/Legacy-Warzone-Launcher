import React from 'react'

// Region → horizontal flag, drawn as a small inline SVG (no image assets).
// Windows WebView2/browsers don't render emoji flags, so CSS/SVG art is the
// only reliable way to show a flag on this platform.
//
// Each flag is a stylized icon for its region, not a literal national flag:
//   North America  → stripes + blue canton (US-inspired)
//   South America  → green field + yellow disc (Brazil-inspired)
//   Europe         → blue field + ring of gold stars (EU-inspired)
//   Asia Pacific   → white field + red disc (Japan-inspired)
//   Middle East    → green field + white band (Saudi-inspired)
//   Oceania        → blue field + white star cluster (Australia-inspired)
//   anything else  → neutral globe (region unset / unknown)
//
// The viewBox is 27×18 (3:2 landscape). Height is sized by the consumer via
// CSS (`height`), so the flag is only a little taller than the player card's
// username text.

const STAR_RING = Array.from({ length: 12 }, (_, index) => {
  const angle = (index / 12) * Math.PI * 2 - Math.PI / 2
  return {
    cx: 13.5 + Math.cos(angle) * 5.8,
    cy: 9 + Math.sin(angle) * 5.8,
  }
})

// Southern-Cross-ish star positions for the Oceania flag.
const OCEANIA_STARS = [
  { cx: 4.5, cy: 4.5 },
  { cx: 9.5, cy: 7.2 },
  { cx: 7.0, cy: 11.5 },
  { cx: 13.0, cy: 5.2 },
  { cx: 15.5, cy: 10.5 },
]

function FlagArt({ region }) {
  switch (region) {
    case 'North America':
      return (
        <>
          <rect width="27" height="18" fill="#ffffff" />
          {[0, 3, 6, 9, 12, 15].map((y) => (
            <rect key={y} x="0" y={y} width="27" height="3" fill="#b22234" />
          ))}
          <rect width="11.5" height="9" fill="#0a3161" />
          {[
            { cx: 2.2, cy: 1.8 }, { cx: 5.8, cy: 1.8 }, { cx: 9.4, cy: 1.8 },
            { cx: 2.2, cy: 4.5 }, { cx: 5.8, cy: 4.5 }, { cx: 9.4, cy: 4.5 },
            { cx: 2.2, cy: 7.2 }, { cx: 5.8, cy: 7.2 }, { cx: 9.4, cy: 7.2 },
          ].map((star) => (
            <circle key={`${star.cx}-${star.cy}`} cx={star.cx} cy={star.cy} r="0.8" fill="#ffffff" />
          ))}
        </>
      )
    case 'South America':
      return (
        <>
          <rect width="27" height="18" fill="#009739" />
          <circle cx="13.5" cy="9" r="5.5" fill="#fedd00" />
        </>
      )
    case 'Europe':
      return (
        <>
          <rect width="27" height="18" fill="#003399" />
          {STAR_RING.map((star) => (
            <circle key={`${star.cx}-${star.cy}`} cx={star.cx} cy={star.cy} r="1.15" fill="#ffcc00" />
          ))}
        </>
      )
    case 'Asia Pacific':
      return (
        <>
          <rect width="27" height="18" fill="#ffffff" />
          <circle cx="13.5" cy="9" r="5" fill="#bc002d" />
        </>
      )
    case 'Middle East':
      return (
        <>
          <rect width="27" height="18" fill="#165d31" />
          <rect x="0" y="6.5" width="27" height="5" fill="#ffffff" />
        </>
      )
    case 'Oceania':
      return (
        <>
          <rect width="27" height="18" fill="#012169" />
          {OCEANIA_STARS.map((star) => (
            <circle key={`${star.cx}-${star.cy}`} cx={star.cx} cy={star.cy} r="1" fill="#ffffff" />
          ))}
        </>
      )
    default:
      // Neutral globe for unset/unknown regions — a circle with a meridian
      // and equator. Deliberately NO cross/X marks: that reads like a
      // broken image icon. The darker field says "no flag set" without
      // looking like a rendering failure.
      return (
        <>
          <rect width="27" height="18" fill="#222933" />
          <circle cx="13.5" cy="9" r="5" fill="none" stroke="#8b98a8" strokeWidth="1.1" />
          <ellipse cx="13.5" cy="9" rx="2.4" ry="5" fill="none" stroke="#8b98a8" strokeWidth="0.7" />
          <path d="M8.5 9 L18.5 9" stroke="#8b98a8" strokeWidth="0.7" />
        </>
      )
  }
}

export default function RegionFlag({ region, className = '' }) {
  return (
    <svg
      viewBox="0 0 27 18"
      className={`region-flag ${className}`}
      role="img"
      aria-label={region || 'Unknown region'}
      preserveAspectRatio="xMidYMid slice"
    >
      <FlagArt region={region} />
    </svg>
  )
}
