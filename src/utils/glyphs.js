import { useControllerType } from './controllerType'
import { useSettings } from '../components/SettingsProvider'

/**
 * Controller / keyboard glyphs.
 *
 * All button artwork lives in src/assets/glyphs/<Platform>/ — eager-imported
 * once below via Vite's import.meta.glob so every platform pack is bundled
 * and lookups are plain string compares. Use `glyphSrc(platform, action)` for
 * any future glyph (never hand-draw button letters again).
 *
 * Platform ids (also the persisted glyph_platform setting values):
 *   'auto'         — detect from the connected controller (Options default)
 *   'keyboard'     — Keyboard & Mouse pack
 *   'xbox'         — Xbox Series pack
 *   'playstation'  — Playstation pack
 *   'switch'       — Nintendo Switch pack
 *   'steam'        — Steam Controller pack
 *   'steamdeck'    — Steam Deck pack
 */

export const GLYPH_PLATFORMS = ['auto', 'keyboard', 'xbox', 'playstation', 'switch', 'steam', 'steamdeck']

// Note: an eager glob of asset files yields the module NAMESPACE ({ default:
// url }) unless `import: 'default'` is requested — see glyphSrc for the
// unwrap that tolerates either shape across dev/prod.
const GLYPH_FILES = import.meta.glob('../assets/glyphs/**/*.png', { eager: true, import: 'default' })

const GLYPH_DIRS = {
  keyboard: 'Keyboard & Mouse',
  xbox: 'Xbox Series',
  playstation: 'Playstation',
  switch: 'Nintendo Switch',
  steam: 'Steam Controller',
  steamdeck: 'Steam Deck',
}

// Semantic action → per-platform glyph file (extension omitted; every entry
// must exist in the pack above — verified at build time via the glob).
const GLYPH_ACTIONS = {
  // Confirm — Enter (keyboard), A (Xbox/Switch/Steam/Deck), Cross (PS).
  confirm: {
    keyboard: 'keyboard_enter_outline',
    xbox: 'xbox_button_color_a_outline',
    playstation: 'playstation_button_color_cross_outline',
    switch: 'switch_button_a_outline',
    steam: 'steam_button_color_a_outline',
    steamdeck: 'steamdeck_button_a_outline',
  },
  // Back / cancel — Esc (keyboard), B (Xbox/Switch/Steam/Deck), Circle (PS).
  back: {
    keyboard: 'keyboard_escape_outline',
    xbox: 'xbox_button_color_b_outline',
    playstation: 'playstation_button_color_circle_outline',
    switch: 'switch_button_b_outline',
    steam: 'steam_button_color_b_outline',
    steamdeck: 'steamdeck_button_b_outline',
  },
  // Aux action (uninstall shortcut) — R (keyboard), Y (Xbox/Switch/Deck),
  // Triangle (PS), Y (Steam Controller).
  uninstall: {
    keyboard: 'keyboard_r_outline',
    xbox: 'xbox_button_color_y_outline',
    playstation: 'playstation_button_color_triangle_outline',
    switch: 'switch_button_y_outline',
    steam: 'steam_button_color_y_outline',
    steamdeck: 'steamdeck_button_y_outline',
  },
  // Navigate — left stick on controllers, arrow cluster on keyboard.
  navigate: {
    keyboard: 'keyboard_arrows_none',
    xbox: 'xbox_stick_l',
    playstation: 'playstation_stick_l',
    switch: 'switch_stick_l',
    steam: 'steam_stick',
    steamdeck: 'steamdeck_stick_l',
  },
}

/** Resolve the glyph image URL for a platform + semantic action (null if unknown). */
export function glyphSrc(platform, action) {
  const dir = GLYPH_DIRS[platform]
  const file = GLYPH_ACTIONS[action]?.[platform]
  if (!dir || !file) return null
  const entry = GLYPH_FILES[`../assets/glyphs/${dir}/${file}.png`]
  if (!entry) return null
  // Eager asset globs return the URL string with `import: 'default'`, but
  // tolerate the module-namespace shape ({ default: url }) defensively — a
  // plain object here would crash React's attribute coercion (src={object}).
  return typeof entry === 'string' ? entry : (entry?.default ?? null)
}

/**
 * Map the detected gamepad type to a glyph platform. Unknown pads follow the
 * Xbox button layout (the de-facto standard); no pad at all means keyboard —
 * the "controller" input mode is driven by the keyboard too.
 */
export function detectedGlyphPlatform(controllerType) {
  if (controllerType === 'xbox' || controllerType === 'other') return 'xbox'
  if (controllerType === 'playstation') return 'playstation'
  if (controllerType === 'switch') return 'switch'
  if (controllerType === 'steam') return 'steam'
  if (controllerType === 'steamdeck') return 'steamdeck'
  return 'keyboard'
}

/** Resolve the effective glyph platform: manual override wins, else detect. */
export function resolveGlyphPlatform(controllerType, override) {
  if (override && override !== 'auto' && GLYPH_PLATFORMS.includes(override)) return override
  return detectedGlyphPlatform(controllerType)
}

/**
 * Hook — the glyph platform to render right now. Polls the connected
 * controller (see useControllerType) and applies the Options > Controller
 * Glyphs override (`glyph_platform` setting; 'auto' = detect).
 *
 * @returns {{ glyphPlatform: 'keyboard' | 'xbox' | 'playstation' | 'switch' | 'steam' | 'steamdeck' }}
 */
export function useGlyphPlatform() {
  const { controllerType } = useControllerType()
  const { settings } = useSettings()
  return { glyphPlatform: resolveGlyphPlatform(controllerType, settings?.glyph_platform) }
}
