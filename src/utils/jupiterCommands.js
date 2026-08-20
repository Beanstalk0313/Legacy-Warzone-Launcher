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

// The available Jupiter maps / modes — single source of truth for the
// Settings dev-server selects and the Host a Match / join flows.
export const JUPITER_MAPS = Object.keys(MAP_IDS)
export const JUPITER_MODES = Object.keys(MODE_SETTINGS)

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

  const parts = [
    `ui_gametype ${effectiveGameType}`,
    `exec ${execHash}`,
    'set enable_automation_bot 1',
    'seta #x3116700c9b39c1eba 40',
    `seta #x3E65E9A96EB2FF62B ${dvarValue}`,
  ]

  let command = parts.join(';')

  // The file appends the map override right after the mode dvar, then any
  // extra dvars (Purgatory's score) inline. The PLUNDER cash-to-win dvar is
  // the exception: it sits on its OWN LINE after the main command, but it
  // still needs the `seta` keyword — a BARE `#x3a07d25d87bb595de` token on
  // its own line is treated as an unknown command by the game and crashes it.
  // (The file's bare line is a trap: `seta` is required.)
  if (combo.mapId) command += `;#x3ef237da69bb64ef6 ${combo.mapId}`
  if (mode === 'Plunder') {
    command += `\nseta ${PLUNDER_CASH_DVAR} ${normalizePlunderCash(plunderCash)}`
  }
  if (combo.extra) command += `;${combo.extra.join(';')}`

  return command
}

