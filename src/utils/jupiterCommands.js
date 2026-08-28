// Config builders for the Warzone III (Jupiter) game, translated from
// `wz commands.txt` (the authoritative command list, updated 30/07/2026).
//
// Each mode's documented map entries below mirror the file byte-for-byte
// (exec hash, map override, extra dvars). Modes the file marks as broken or
// not working (Loaded Resurgence, Battle Royal, Ranked Battle Royal) are NOT
// exposed. Undocumented (mode, map) combos fall back to the map's standard
// config hash so every selectable combination still produces a command.

const MAP_IDS = {
  // Rebirth Island first: it's the file's canonical, most-tested config and
  // therefore the default the Host a Match form (and dev-server select)
  // land on. Newer maps (e.g. Hellspawn) stay available but aren't the
  // silent default.
  'Rebirth Island': 'mp_jup_escape5',
  'Hellspawn': 'mp_jup_escape5_hell',
  "Fortune's Keep": 'mp_jup_sm_island_2',
  Vondel: 'mp_jup_delta',
  Urzikstan: 'mp_jup_bigmap_wz2',
  'Vondel Night': 'mp_jup_delta_alt',
}

// Fallback exec hash per map for (mode, map) combos the file doesn't
// document. Rebirth/Fortune's Keep/Vondel come from the file's
// "RESURGENCE CFG FOR EVERY MAP" section; Urzikstan uses the file's
// "BATTLE ROYAL/MINI URZIKSTAN CFG" hash; Vondel Night + Hellspawn reuse
// their parent maps' configs (their documented entries all do the same).
const STANDARD_MAP_CONFIGS = {
  'Hellspawn': '#x441C1E675F5527973',
  'Rebirth Island': '#x441C1E675F5527973',
  "Fortune's Keep": '#x4614027DCA9FAFA63',
  Vondel: '#x413DC4D00BF9AEFB3',
  Urzikstan: '#x43B0AD900F42FF5D5',
  'Vondel Night': '#x413DC4D00BF9AEFB3',
}

// The file's Plunder cash-to-win dvar and its default value.
export const PLUNDER_CASH_DVAR = '#x3a07d25d87bb595de'
export const PLUNDER_DEFAULT_CASH = 2000000000

// Per-mode configs exactly as documented in wz commands.txt:
//   exec     – the exec hash the file pairs with this mode+map
//   mapId    – the `;#x3ef237da69bb64ef6 <mapId>` override the file appends
//   gameType – ui_gametype override (Mini Royal Urzikstan uses `br`)
//   extra    – additional dvars the file appends (Purgatory's score dvar)
// Modes the file marks broken are intentionally absent.
const MODE_MAP_CONFIGS = {
  Resurgence: {
    'Rebirth Island': { exec: '#x441C1E675F5527973' },
    "Fortune's Keep": { exec: '#x4614027DCA9FAFA63' },
    Vondel: { exec: '#x413DC4D00BF9AEFB3' },
    Hellspawn: { exec: '#x441C1E675F5527973', mapId: 'mp_jup_escape5_hell' },
  },
  'Juggernaut Royal': {
    'Rebirth Island': { exec: '#x441C1E675F5527973' },
    Urzikstan: { exec: '#x43B0AD900F42FF5D5' },
  },
  'Ranked Resurgence': {
    'Rebirth Island': { exec: '#x441C1E675F5527973' },
    "Fortune's Keep": { exec: '#x4614027DCA9FAFA63' },
    Vondel: { exec: '#x413DC4D00BF9AEFB3' },
  },
  Lockdown: {
    'Rebirth Island': { exec: '#x441C1E675F5527973' },
    Vondel: { exec: '#x413DC4D00BF9AEFB3' },
    "Fortune's Keep": { exec: '#x4614027DCA9FAFA63' },
    // The updated file runs Vondel Night on the REBIRTH config + override.
    'Vondel Night': { exec: '#x441C1E675F5527973', mapId: 'mp_jup_delta_alt' },
    Hellspawn: { exec: '#x441C1E675F5527973', mapId: 'mp_jup_escape5_hell' },
  },
  Plunder: {
    'Rebirth Island': { exec: '#x441C1E675F5527973' },
    Vondel: { exec: '#x41FEDD0BAA22135A8' },
    "Fortune's Keep": { exec: '#x4614027DCA9FAFA63' },
    Hellspawn: { exec: '#x41FEDD0BAA22135A8', mapId: 'mp_jup_escape5_hell' },
    'Vondel Night': { exec: '#x441C1E675F5527973', mapId: 'mp_jup_delta_alt' },
    Urzikstan: { exec: '#x441C1E675F5527973', mapId: 'mp_jup_bigmap_wz2' },
  },
  'Zombie Royal': {
    Hellspawn: { exec: '#x441C1E675F5527973', mapId: 'mp_jup_escape5_hell' },
    'Vondel Night': { exec: '#x441C1E675F5527973', mapId: 'mp_jup_delta_alt' },
  },
  Purgatory: {
    'Rebirth Island': { exec: '#x441C1E675F5527973', extra: ['seta #x3279375A0BFB2862F 100'] },
  },
  'Supreme Resurgence': {
    'Rebirth Island': { exec: '#x441C1E675F5527973' },
  },
  'Mini Royal': {
    Vondel: { exec: '#x413DC4D00BF9AEFB3' },
    // The file's Urzikstan Mini entry uses ui_gametype br + its own hash.
    Urzikstan: { exec: '#x41D0100B4F74A50F9', mapId: 'mp_jup_bigmap_wz2', gameType: 'br' },
  },
  'Massive Resurgence': {
    'Rebirth Island': { exec: '#x441C1E675F5527973' },
    "Fortune's Keep": { exec: '#x4614027DCA9FAFA63' },
    Vondel: { exec: '#x413DC4D00BF9AEFB3' },
  },
  'POI Resurgence': {
    'Rebirth Island': { exec: '#x441C1E675F5527973' },
    "Fortune's Keep": { exec: '#x4614027DCA9FAFA63' },
    Vondel: { exec: '#x413DC4D00BF9AEFB3' },
  },
}

// mode → [ui_gametype, mode-dvar value]. Loaded Resurgence, Battle Royal and
// Ranked Battle Royal were removed because the file marks them broken.
const MODE_SETTINGS = {
  Resurgence: ['resurgence', 'resurgence'],
  'Juggernaut Royal': ['jugg', 'jugg'],
  'Ranked Resurgence': ['resranked', 'resranked'],
  Lockdown: ['zonecontrol', 'zonecontrol'],
  Plunder: ['plunder', 'plunder'],
  'Zombie Royal': ['zxp', 'zxp'],
  Purgatory: ['limbo', 'limbo'],
  'Supreme Resurgence': ['resurgsupreme', 'resurgsupreme'],
  'Mini Royal': ['mini', 'mini'],
  'Massive Resurgence': ['resurgmass', 'resurgmass'],
  'POI Resurgence': ['poiresurgence', 'poiresurgence'],
}

// The available Warzone (BR) maps / modes — the ones documented in
// wz commands.txt with real exec hashes. Single source of truth for the
// Settings dev-server selects and the Host a Match / join flows.
export const WARZONE_MAPS = Object.keys(MAP_IDS)
export const WARZONE_MODES = Object.keys(MODE_SETTINGS)

// ── Multiplayer / zombies lists ──────────────────────────────────────────
// These are UI-only lists: the game's own lobby handles multiplayer and
// zombies matches natively, so they need NO exec-hash config cbuf — only
// the LAN session matters (see modeNeedsConfig below). Names are displayed
// verbatim in the Host a Match / Server Browser dropdowns.
//
// Multiplayer modes — hardcore variants are separate entries (per spec).
export const MULTIPLAYER_MODES = [
  'Team Death Match',
  'Hardcore Team Death Match',
  'Domination',
  'Hardcore Domination',
  'Search and Destroy',
  'Hardcore Search and Destroy',
  'Kill Confirmed',
  'Hardcore Kill Confirmed',
  'Free For All',
  'Hardcore Free For All',
  'Hardpoint',
  'Hardcore Hardpoint',
  'Capture the Flag',
  'Demolition',
  'Gunfight',
  'Cyber Attack',
  'Hardcore Cyber Attack',
  'Headquarters',
  'Hardcore Headquarters',
  'Control',
  'Hardcore Control',
  'Escort',
  'Havoc',
  'COD Warrior',
  'War',
  'Cutthroat',
  'Bounty',
  'Hyper Cranked',
  'Minefield',
  'Vortex',
  'Hordepoint',
  'Snipers Only Team Death Match',
  'G3T_H1GH3R',
  'Defuse or Destroy',
  'Hardcore Defuse or Destroy',
  'Infected',
  'Gun Game',
  'Ground War',
  'Invasion',
  'One in the Chamber',
  'All or Nothing',
  'Team Gun Game',
  'Infectious Holiday',
  'Fishfection',
  'CDL Hardpoint',
  'CDL Search and Destroy',
  'CDL Control',
]

// Multiplayer maps.
export const MULTIPLAYER_MAPS = [
  '6 Star',
  'Afghan',
  'Airborne',
  'Alley',
  'Arena Shipment',
  'Bait',
  'Bit-ment',
  'Bitvela',
  'Blacksite',
  'Bloody Meat',
  'Breenbergh Hotel',
  'Celship',
  'Checkpoint',
  'Crown Raceway',
  'Das Gross',
  'Das Haus',
  'Departures',
  'Derail',
  'Dome',
  'Drive Thru',
  'Emergency',
  'Estate',
  'Exhbit',
  'Farm 18',
  'Favela',
  'G3T_H1GH',
  'Ghost Ship',
  'Greece',
  'Grime',
  'Growhouse',
  'Hang Over',
  'Highrise',
  'Incline',
  'Ink House',
  'Karachi',
  'Meant',
  'Mercado Las Almas',
  'Paris',
  'Quarry',
  'Rio',
  'Rundown',
  'Rust',
  "Satan's Quarry",
  'Scrapyard',
  'Shipmas',
  'Shipment',
  'Shoot House',
  'Skidgrow',
  'Sporeyard',
  'Stash House',
  'Stay High',
  'Sub Base',
  'Sunny Shipment',
  'Tanked',
  'Terminal',
  'Tetanus',
  'Tokyo',
  'Toonoxide',
  'Training Facility',
  'Underpass',
  'Vista',
  'Wasteland',
  'Yard',
]

// Zombies maps — zombies has NO mode toggle (single fixed mode).
export const ZOMBIES_MAPS = [
  'Confront Zakhaev',
  'Dark Aether',
  'Exfil Dr. Janse',
  'Test Site',
  'Urzikstan',
]

// The zombie lobby's fixed mode (zombies has no mode toggle).
export const ZOMBIES_MODE = 'Zombies'

/** The map list shown for a given game mode. */
export function mapsForMode(gameMode) {
  if (gameMode === 'zombies') return ZOMBIES_MAPS
  if (gameMode === 'warzone') return WARZONE_MAPS
  return MULTIPLAYER_MAPS
}

/**
 * The mode list shown for a given game mode. Zombies returns [] — the
 * mode is fixed (see ZOMBIES_MODE), so no mode dropdown renders.
 */
export function modesForMode(gameMode) {
  if (gameMode === 'zombies') return []
  if (gameMode === 'warzone') return WARZONE_MODES
  return MULTIPLAYER_MODES
}

/**
 * Whether the join/host flow pushes an exec-hash config cbuf for this game
 * mode. Only the Warzone (BR) modes are documented in wz commands.txt with
 * real hashes — multiplayer and zombies matches are configured natively by
 * the game's own lobby, so their flows only need the LAN session join.
 */
export function modeNeedsConfig(gameMode) {
  return gameMode === 'warzone'
}

/** Coerce a user-entered plunder cash amount; empty/invalid → file default. */
export function normalizePlunderCash(value) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed || !/^\d{1,10}$/.test(trimmed)) return PLUNDER_DEFAULT_CASH
  const amount = Number(trimmed)
  return Number.isSafeInteger(amount) && amount > 0 ? amount : PLUNDER_DEFAULT_CASH
}

/**
 * Build the config cbuf from the mode/map rows in wz commands.txt.
 * The returned string is intended for the RTM tool's Cbuf Add Text field.
 * The command is written without a leading slash because it is a game cbuf
 * command rather than a chat-style slash command.
 *
 * `plunderCash` only applies to Plunder lobbies (default 2000000000 per the
 * file) — it emits the cash-to-win dvar `seta #x3a07d25d87bb595de <cash>`.
 */
export function getJupiterConfigCommand({ map, mode, plunderCash }) {
  const [gameType, dvarValue] = MODE_SETTINGS[mode] || MODE_SETTINGS.Resurgence
  const combo = MODE_MAP_CONFIGS[mode]?.[map] || {}
  const execHash = combo.exec || STANDARD_MAP_CONFIGS[map] || STANDARD_MAP_CONFIGS['Rebirth Island']
  const effectiveGameType = combo.gameType || gameType

  // Every command is semicolon-joined on one line, but the SECOND (and any
  // subsequent) `seta` dvar goes on its own newline so the RTM tool receives
  // them as separate statements — matching the wz commands.txt format.
  const nonSetaParts = [
    `ui_gametype ${effectiveGameType}`,
    `exec ${execHash}`,
    'set enable_automation_bot 1',
  ]
  const setaParts = [
    'seta #x3116700c9b39c1eba 40',
    `seta #x3E65E9A96EB2FF62B ${dvarValue}`,
  ]

  let command = [...nonSetaParts, setaParts[0]].join(';')
  for (let i = 1; i < setaParts.length; i += 1) {
    command += `\n${setaParts[i]}`
  }

  // The file appends the map override right after the mode dvar, then any
  // extra dvars (Purgatory's score, Plunder's cash-to-win) on their own
  // newline — each one is a `seta` statement that must start its own line.
  if (combo.mapId) command += `;#x3ef237da69bb64ef6 ${combo.mapId}`
  if (mode === 'Plunder') {
    command += `\nseta ${PLUNDER_CASH_DVAR} ${normalizePlunderCash(plunderCash)}`
  }
  if (combo.extra) {
    for (const extra of combo.extra) {
      command += `\n${extra}`
    }
  }

  return command
}

