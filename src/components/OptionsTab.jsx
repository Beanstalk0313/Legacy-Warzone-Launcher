import React, { useEffect, useMemo, useState } from 'react'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { focusTextInput } from '../utils/keyboard'
import { useSettings } from './SettingsProvider'
import { mapsForMode, modesForMode } from '../utils/jupiterCommands'
import { listMonitors } from '../utils/displayMode'
import CustomSelect from './CustomSelect'
import { useAuth } from './AuthProvider'
import { resetTutorialSeen } from './TutorialOverlay'
import { LANGUAGES, useTranslation } from '../utils/i18n'
import { version as APP_VERSION } from '../../package.json'

const DISPLAY_MODE_OPTIONS = [
  { value: 'fullscreen', label: 'Fullscreen' },
  { value: 'windowed', label: 'Windowed' },
]

const SILENT_MODE_OPTIONS = [
  { value: false, label: 'Off' },
  { value: true, label: 'On' },
]

// Controller/keyboard glyph packs — 'auto' detects the connected controller.
const GLYPH_OPTIONS = [
  { value: 'auto', label: 'Auto (Detect)' },
  { value: 'keyboard', label: 'Keyboard & Mouse' },
  { value: 'xbox', label: 'Xbox' },
  { value: 'playstation', label: 'PlayStation' },
  { value: 'switch', label: 'Nintendo Switch' },
  { value: 'steam', label: 'Steam Controller' },
  { value: 'steamdeck', label: 'Steam Deck' },
]

// {value,label} option lists keyed by setting — single source for the select
// rows' labels ↔ stored values (display_monitor is special-cased below).
const OPTION_LISTS = {
  display_mode: DISPLAY_MODE_OPTIONS,
  silent_mode: SILENT_MODE_OPTIONS,
  glyph_platform: GLYPH_OPTIONS,
  language: LANGUAGES,
}

// Theme accent color presets.
const ACCENT_PRESETS = [
  '#028fcc', // default cyan
  '#00e5ff', // bright cyan
  '#7c4dff', // purple
  '#00e676', // green
  '#ffea00', // gold
  '#ff6d00', // orange
]

// Options sub-tabs. Switched by the controller TRIGGERS (LT/RT, or [ / ] on
// the keyboard) so the bumpers stay free for top-level tab switching — see
// the onTrigger wiring in useControllerNavigation below.
const OPTIONS_SUB_TABS = [
  { key: 'general', label: 'GENERAL' },
  { key: 'display', label: 'DISPLAY' },
  { key: 'developer', label: 'DEVELOPER' },
  { key: 'about', label: 'ABOUT' },
]

export default function OptionsTab({ theme = 'jupiter', onModalChange, onRetakeTutorial, gameMode = 'multiplayer' }) {
  const hoverSound = 'jupHover'
  const selectSound = 'jupSelect'
  const { user } = useAuth()
  const { settings, setSetting, resetSettings } = useSettings()
  const { t } = useTranslation()
  // Controller mode + the dropdown that's expanded (null = closed). The
  // dropdown's option list becomes the controller nav target while open
  // (the options hook below) — same pattern as Host a Match.
  const [inputMode, setInputMode] = useState('mouse')
  const [openSelect, setOpenSelect] = useState(null)
  // Active sub-tab (general | display | developer) — moved by the triggers.
  const [section, setSection] = useState('general')
  // The displays available to the launcher (desktop only; [] in the
  // browser): { name, ordinal, primary }. name is the persisted value.
  const [monitors, setMonitors] = useState([])

  // Fetch the monitor list once — the dropdown labels derive from ordinal /
  // primary, and the stored value stays the OS monitor name.
  useEffect(() => {
    let mounted = true
    listMonitors()
      .then((list) => { if (mounted) setMonitors(list) })
      .catch(() => { /* browser dev / no Tauri — keep [] */ })
    return () => { mounted = false }
  }, [])

  // While a settings dropdown is open the parent interface's controller
  // nav must go quiet — Esc/B would otherwise jump back to Play mid-
  // interaction. Released on unmount.
  useEffect(() => {
    onModalChange?.(Boolean(openSelect))
    return () => onModalChange?.(false)
  }, [onModalChange, openSelect])

  const handleHover = () => playSound(hoverSound)

  const switchSection = (next) => {
    if (next === section || openSelect) return
    playSound(selectSound)
    setOpenSelect(null)
    setSection(next)
  }

  const subTabIndex = (key) => OPTIONS_SUB_TABS.findIndex((tab) => tab.key === key)

  const handleChange = (key, value) => {
    playSound(selectSound)
    setSetting(key, value)
  }

  const handleReset = () => {
    playSound(selectSound)
    resetSettings()
  }

  const handleRetakeTutorial = () => {
    playSound(selectSound)
    if (user?.id) resetTutorialSeen(user.id)
    onRetakeTutorial?.()
  }

  const valueOf = (key) => settings?.[key]
  const testingServerOn = Boolean(valueOf('testing_server'))
  const rtmModeOn = Boolean(valueOf('rtm_mode'))

  // ── Controller navigation items (the active sub-tab's rows) ────────────
  // The Reset row sits at the bottom of EVERY sub-tab's list so the button
  // is reachable from anywhere; it renders once, below the section cards.
  const navItems = useMemo(() => {
    const items = []
    if (section === 'general') {
      // ORDER MUST MATCH THE DOM: THEME card → SOUND card → INTERFACE card.
      items.push({ kind: 'accent', key: 'accent_jupiter', label: t('options.accent.jup') })
      items.push({ kind: 'toggle', key: 'silent_mode', label: t('options.silentmode') })
      items.push({ kind: 'toggle', key: 'music_enabled', label: t('options.music') })
      // The zombies classic-soundtrack toggle is zombies-mode only.
      if (gameMode === 'zombies') {
        items.push({ kind: 'toggle', key: 'zombies_classic_ost', label: t('options.zombiesclassic') })
      }
      items.push({ kind: 'select', key: 'glyph_platform', label: t('options.glyphplatform') })
      items.push({ kind: 'toggle', key: 'auto_load_savedata', label: t('options.autoloadsavedata') })
      items.push({ kind: 'button', key: 'retake_tutorial', label: t('options.tutorial') })
    } else if (section === 'display') {
      items.push({ kind: 'select', key: 'language', label: t('options.language') })
      items.push({ kind: 'select', key: 'display_mode', label: t('options.displaymode') })
      items.push({ kind: 'select', key: 'display_monitor', label: t('options.displaymonitor') })
    } else if (section === 'about') {
      // About is read-only content — no interactive rows.
    } else {
      items.push({ kind: 'toggle', key: 'testing_server', label: t('options.testingserver') })
      if (testingServerOn) {
        items.push({ kind: 'text', key: 'dev_server_name', label: t('options.devserver.name') })
        items.push({ kind: 'select', key: 'dev_server_map', label: t('options.devserver.map') })
        // The dev-server mode select follows the current mode's list —
        // zombies has no modes, so the row is omitted there.
        if (modesForMode(gameMode).length > 0) {
          items.push({ kind: 'select', key: 'dev_server_mode', label: t('options.devserver.mode') })
        }
        items.push({ kind: 'text', key: 'dev_server_lan_session', label: t('options.devserver.lansession') })
      }
      items.push({ kind: 'toggle', key: 'rtm_mode', label: t('options.advancedrtm') })
    }
    items.push({ kind: 'reset', label: t('options.reset') })
    return items
  }, [section, testingServerOn, rtmModeOn, gameMode, modesForMode(gameMode).length])

  const monitorLabel = (monitor) =>
    `Display ${monitor.ordinal}${monitor.primary ? ' (Primary)' : ''}`

  // Select field plumbing: options are display strings for the picker; the
  // stored value for {value,label} lists is the `value` half. The Display
  // Monitor picker stores the OS monitor NAME — the label is derived from
  // ordinal/primary, so the two map through the in-memory monitor list.
  const selectOptions = (key) => {
    if (key === 'display_monitor') return ['Default', ...monitors.map(monitorLabel)]
    if (OPTION_LISTS[key]) return OPTION_LISTS[key].map((option) => option.label)
    if (key === 'dev_server_map') return mapsForMode(gameMode)
    if (key === 'dev_server_mode') return modesForMode(gameMode)
    return []
  }
  const selectStoredValue = (key, display) => {
    if (key === 'display_monitor') {
      const monitor = monitors.find((item) => monitorLabel(item) === display)
      return monitor ? monitor.name : ''
    }
    return OPTION_LISTS[key]?.find((option) => option.label === display)?.value ?? display
  }
  const selectDisplay = (key) => {
    const stored = valueOf(key)
    if (key === 'display_monitor') {
      if (!stored) return 'Default'
      const monitor = monitors.find((item) => item.name === stored)
      return monitor ? monitorLabel(monitor) : String(stored)
    }
    return OPTION_LISTS[key]?.find((option) => option.value === stored)?.label ?? stored
  }

  const openOptions = openSelect ? selectOptions(openSelect) : []
  const openCurrentDisplay = openSelect ? selectDisplay(openSelect) : ''

  // Rows hook — navigates the active sub-tab's rows; a select opens its
  // dropdown, a toggle flips, a text field hands off to the on-screen
  // keyboard. The TRIGGERS (LT/RT, [ ]) switch sub-tabs — the bumpers stay
  // owned by the interface hook for top-level tabs.
  //
  // The Reset button sits outside the section cards in the DOM but is the
  // last item in navItems. Custom onNavigate makes it a terminal node:
  // Down from the last setting row → Reset; Up from Reset → last setting;
  // Down from Reset / Up from first row → stay (no wrap-around to the
  // opposite end, which would jump past the visual card boundary).
  const focusedIndex = useControllerNavigation({
    itemCount: navItems.length,
    allowedDirections: ['up', 'down'],
    onControllerActivity: () => setInputMode('controller'),
    onMove: (index) => {
      setInputMode('controller')
      playSound(hoverSound)
    },
    onNavigate: (direction, currentIndex) => {
      const count = navItems.length
      if (count < 2) return currentIndex
      const lastSettingIdx = navItems.findIndex((item) => item.kind === 'reset') - 1
      const resetIdx = lastSettingIdx + 1
      if (direction === 'down') {
        if (currentIndex === resetIdx) return currentIndex // already on Reset
        if (currentIndex >= lastSettingIdx) return resetIdx // last setting → Reset
        return currentIndex + 1
      }
      if (direction === 'up') {
        if (currentIndex === 0) return currentIndex // first row — don't wrap to Reset
        if (currentIndex === resetIdx) return lastSettingIdx // Reset → last setting
        return currentIndex - 1
      }
      return currentIndex
    },
    onTrigger: (direction) => {
      setInputMode('controller')
      const index = subTabIndex(section)
      const next = OPTIONS_SUB_TABS[(index + (direction === 'right' ? 1 : -1) + OPTIONS_SUB_TABS.length) % OPTIONS_SUB_TABS.length]
      switchSection(next.key)
    },
    onConfirm: (index, source) => {
      setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
      const item = navItems[index]
      if (!item) return
      if (item.kind === 'select') {
        playSound(selectSound)
        setOpenSelect(item.key)
        return
      }
      if (item.kind === 'toggle') {
        playSound(selectSound)
        setSetting(item.key, !valueOf(item.key))
        return
      }
      if (item.kind === 'text') {
        focusTextInput(`[data-options-input="${item.key}"]`, setInputMode)
        return
      }
      if (item.kind === 'accent') {
        playSound(selectSound)
        const current = valueOf(item.key)
        const idx = ACCENT_PRESETS.indexOf(current)
        setSetting(item.key, ACCENT_PRESETS[(idx + 1) % ACCENT_PRESETS.length])
        return
      }
      if (item.kind === 'button' && item.key === 'retake_tutorial') {
        handleRetakeTutorial()
        return
      }
      if (item.kind === 'reset') handleReset()
    },
    enabled: !openSelect,
  })

  // Options hook — while a dropdown is open, up/down moves through OPTIONS
  // and A confirms one (B / Esc closes without changing).
  const optionFocusedIndex = useControllerNavigation({
    itemCount: openOptions.length,
    initialIndex: openSelect ? Math.max(0, openOptions.indexOf(openCurrentDisplay)) : 0,
    allowedDirections: ['up', 'down'],
    onControllerActivity: () => setInputMode('controller'),
    onMove: (index) => {
      setInputMode('controller')
      playSound(hoverSound)
    },
    onConfirm: (index, source) => {
      const display = openOptions[index]
      if (!openSelect || display === undefined) return
      setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
      handleChange(openSelect, selectStoredValue(openSelect, display))
      setOpenSelect(null)
    },
    onBack: () => {
      playSound(selectSound)
      setOpenSelect(null)
    },
    enabled: Boolean(openSelect),
  })

  const isRowFocused = (key) => inputMode === 'controller' && navItems[focusedIndex]?.key === key
  const isResetFocused = () => inputMode === 'controller' && navItems[focusedIndex]?.kind === 'reset'

  return (
    <div className="tab-content-panel jupiter-theme">
      <div className="tab-header-title">
        <h2>OPTIONS</h2>

      </div>

      {/* Sub-tab bar — triggers (LT/RT) or [ ] switch sections on a
          controller; mouse users click directly. */}
      <div className="options-subtabs" role="tablist" aria-label="Options sections">
        {OPTIONS_SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={section === tab.key}
            className={`options-subtab ${section === tab.key ? 'active' : ''} jupiter-theme`}
            onMouseEnter={handleHover}
            onClick={() => switchSection(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <span className="options-subtabs-hint">Triggers / [ ] switch sections</span>
      </div>

      <div className="options-sections">
        {section === 'general' && (
          <>
            <div className="options-card">
              <h3>{t('options.theme')}</h3>

              <label className={`options-row options-row-accent ${isRowFocused('accent_jupiter') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
                <div className="options-row-label">
                  <strong>{t('options.accent.jup')}</strong>
                  <span>{t('options.accent.jup.desc')}</span>
                </div>
                <div className="accent-swatches">
                  {ACCENT_PRESETS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      className={`accent-swatch ${valueOf('accent_jupiter') === hex ? 'active' : ''}`}
                      style={{ backgroundColor: hex }}
                      onClick={() => { playSound(selectSound); setSetting('accent_jupiter', hex) }}
                      onMouseEnter={handleHover}
                      aria-label={`Accent ${hex}`}
                      title={hex}
                    />
                  ))}
                  <input
                    type="color"
                    className="accent-picker-input"
                    value={valueOf('accent_jupiter') || '#028fcc'}
                    onChange={(event) => { playSound(selectSound); setSetting('accent_jupiter', event.target.value) }}
                    onMouseEnter={handleHover}
                    aria-label="Custom accent color"
                    title="Pick a custom color"
                  />
                </div>
              </label>
            </div>

            <div className="options-card">
              <h3>{t('options.sound')}</h3>

              <label className={`options-row ${isRowFocused('silent_mode') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
                <div className="options-row-label">
                  <strong>{t('options.silentmode')}</strong>
                  <span>{t('options.silentmode.desc')}</span>
                </div>
                <span className={`options-toggle ${valueOf('silent_mode') ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={Boolean(valueOf('silent_mode'))}
                    onChange={(event) => {
                      playSound(selectSound)
                      setSetting('silent_mode', event.target.checked)
                    }}
                    onMouseEnter={handleHover}
                    aria-label="Silent Mode"
                  />
                  <span className="options-toggle-track" aria-hidden="true" />
                </span>
              </label>

              <label className={`options-row ${isRowFocused('music_enabled') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
                <div className="options-row-label">
                  <strong>{t('options.music')}</strong>
                  <span>{t('options.music.desc')}</span>
                </div>
                <span className={`options-toggle ${valueOf('music_enabled') ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={Boolean(valueOf('music_enabled'))}
                    onChange={(event) => {
                      playSound(selectSound)
                      setSetting('music_enabled', event.target.checked)
                    }}
                    onMouseEnter={handleHover}
                    aria-label="Music"
                  />
                  <span className="options-toggle-track" aria-hidden="true" />
                </span>
              </label>

              {gameMode === 'zombies' && (
                <label className={`options-row ${isRowFocused('zombies_classic_ost') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
                  <div className="options-row-label">
                    <strong>{t('options.zombiesclassic')}</strong>
                    <span>{t('options.zombiesclassic.desc')}</span>
                  </div>
                  <span className={`options-toggle ${valueOf('zombies_classic_ost') ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={Boolean(valueOf('zombies_classic_ost'))}
                      onChange={(event) => {
                        playSound(selectSound)
                        setSetting('zombies_classic_ost', event.target.checked)
                      }}
                      onMouseEnter={handleHover}
                      aria-label="Zombies Classic Soundtrack"
                    />
                    <span className="options-toggle-track" aria-hidden="true" />
                  </span>
                </label>
              )}
            </div>

            <div className="options-card">
              <h3>{t('options.interface')}</h3>

              <label className={`options-row ${isRowFocused('glyph_platform') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
                <div className="options-row-label">
                  <strong>{t('options.glyphplatform')}</strong>
                  <span>{t('options.glyphplatform.desc')}</span>
                </div>
                <CustomSelect
                  value={selectDisplay('glyph_platform')}
                  options={selectOptions('glyph_platform')}
                  onSelect={(display) => handleChange('glyph_platform', selectStoredValue('glyph_platform', display))}
                  isOpen={openSelect === 'glyph_platform'}
                  onToggle={() => setOpenSelect(openSelect === 'glyph_platform' ? null : 'glyph_platform')}
                  onClose={() => setOpenSelect(null)}
                  focusIndex={openSelect === 'glyph_platform' ? optionFocusedIndex : null}
                  theme={theme}
                  ariaLabel="Controller Glyphs"
                />
              </label>

              <label className={`options-row ${isRowFocused('auto_load_savedata') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
                <div className="options-row-label">
                  <strong>{t('options.autoloadsavedata')}</strong>
                  <span>{t('options.autoloadsavedata.desc')}</span>
                </div>
                <span className={`options-toggle ${valueOf('auto_load_savedata') ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={Boolean(valueOf('auto_load_savedata'))}
                    onChange={(event) => {
                      playSound(selectSound)
                      setSetting('auto_load_savedata', event.target.checked)
                    }}
                    onMouseEnter={handleHover}
                    aria-label="Auto-Load Save Data"
                  />
                  <span className="options-toggle-track" aria-hidden="true" />
                </span>
              </label>

              <div
                className={`options-row options-row-action ${isRowFocused('retake_tutorial') ? 'controller-focused' : ''}`}
                onClick={handleRetakeTutorial}
                onMouseEnter={handleHover}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRetakeTutorial() } }}
              >
                <div className="options-row-label">
                  <strong>{t('options.tutorial')}</strong>
                  <span>{t('options.tutorial.desc')}</span>
                </div>
                <button
                  type="button"
                  className="btn-options-action"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRetakeTutorial()
                  }}
                  onMouseEnter={handleHover}                  >
                  {t('options.retaketutorial.btn')}
                </button>
              </div>
            </div>

          </>
        )}

        {section === 'display' && (
          <div className="options-card">
            <h3>{t('options.subtab.display')}</h3>

            <label className={`options-row ${isRowFocused('language') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
              <div className="options-row-label">
                <strong>{t('options.language')}</strong>
                <span>{t('options.language.desc')}</span>
              </div>
              <CustomSelect
                value={selectDisplay('language')}
                options={selectOptions('language')}
                onSelect={(display) => handleChange('language', selectStoredValue('language', display))}
                isOpen={openSelect === 'language'}
                onToggle={() => setOpenSelect(openSelect === 'language' ? null : 'language')}
                onClose={() => setOpenSelect(null)}
                focusIndex={openSelect === 'language' ? optionFocusedIndex : null}
                theme={theme}
                ariaLabel={t('options.language')}
              />
            </label>

            <label className={`options-row ${isRowFocused('display_mode') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
              <div className="options-row-label">
                <strong>{t('options.displaymode')}</strong>
                <span>{t('options.displaymode.desc')}</span>
              </div>
              <CustomSelect
                value={selectDisplay('display_mode')}
                options={selectOptions('display_mode')}
                onSelect={(display) => handleChange('display_mode', selectStoredValue('display_mode', display))}
                isOpen={openSelect === 'display_mode'}
                onToggle={() => setOpenSelect(openSelect === 'display_mode' ? null : 'display_mode')}
                onClose={() => setOpenSelect(null)}
                focusIndex={openSelect === 'display_mode' ? optionFocusedIndex : null}
                theme={theme}
                ariaLabel="Display Mode"
              />
            </label>

            <label className={`options-row ${isRowFocused('display_monitor') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
              <div className="options-row-label">
                <strong>{t('options.displaymonitor')}</strong>
                <span>{t('options.displaymonitor.desc')}</span>
              </div>
              <CustomSelect
                value={selectDisplay('display_monitor')}
                options={selectOptions('display_monitor')}
                onSelect={(display) => handleChange('display_monitor', selectStoredValue('display_monitor', display))}
                isOpen={openSelect === 'display_monitor'}
                onToggle={() => setOpenSelect(openSelect === 'display_monitor' ? null : 'display_monitor')}
                onClose={() => setOpenSelect(null)}
                focusIndex={openSelect === 'display_monitor' ? optionFocusedIndex : null}
                theme={theme}
                ariaLabel="Display Monitor"
              />
            </label>
          </div>
        )}

        {section === 'developer' && (
          <div className="options-card">
            {/* Testing Server — a LOCAL-ONLY test server row in the Server
                Browser / Quick Play (never touches Supabase, invisible to
                other clients) — and Advanced RTM Mode, which shows the raw
                RTM DEV TOOL panel on the RTM tab. Split into two independent
                toggles; the test-server metadata fields appear under the
                Testing Server toggle. All persisted to settings. */}
            <h3>{t('options.developer.testingrtm')}</h3>

            <label className={`options-row ${isRowFocused('testing_server') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
              <div className="options-row-label">
                <strong>{t('options.testingserver')}</strong>
                <span>{t('options.testingserver.desc')}</span>
              </div>
              <span className={`options-toggle ${valueOf('testing_server') ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={Boolean(valueOf('testing_server'))}
                  onChange={(event) => {
                    playSound(selectSound)
                    setSetting('testing_server', event.target.checked)
                  }}
                  onMouseEnter={handleHover}
                  aria-label="Testing Server"
                />
                <span className="options-toggle-track" aria-hidden="true" />
              </span>
            </label>

            {testingServerOn && (
              <div className="options-dev-fields">
                <label className={`options-row ${isRowFocused('dev_server_name') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
                  <div className="options-row-label">
                    <strong>{t('options.devserver.name')}</strong>
                    <span>{t('options.devserver.name.desc')}</span>
                  </div>
                  <input
                    type="text"
                    className="options-text-input"
                    data-options-input="dev_server_name"
                    value={valueOf('dev_server_name')}
                    onChange={(event) => setSetting('dev_server_name', event.target.value)}
                    onMouseEnter={handleHover}
                    maxLength={64}
                    spellCheck={false}
                  />
                </label>

                <label className={`options-row ${isRowFocused('dev_server_map') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
                  <div className="options-row-label">
                    <strong>{t('options.devserver.map')}</strong>
                    <span>{t('options.devserver.map.desc')}</span>
                  </div>
                  <CustomSelect
                    value={selectDisplay('dev_server_map')}
                    options={selectOptions('dev_server_map')}
                    onSelect={(display) => handleChange('dev_server_map', selectStoredValue('dev_server_map', display))}
                    isOpen={openSelect === 'dev_server_map'}
                    onToggle={() => setOpenSelect(openSelect === 'dev_server_map' ? null : 'dev_server_map')}
                    onClose={() => setOpenSelect(null)}
                    focusIndex={openSelect === 'dev_server_map' ? optionFocusedIndex : null}
                    theme={theme}
                    ariaLabel="Test Server Map"
                  />
                </label>

                {modesForMode(gameMode).length > 0 && (
                  <label className={`options-row ${isRowFocused('dev_server_mode') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
                    <div className="options-row-label">
                      <strong>{t('options.devserver.mode')}</strong>
                      <span>{t('options.devserver.mode.desc')}</span>
                    </div>
                    <CustomSelect
                      value={selectDisplay('dev_server_mode')}
                      options={selectOptions('dev_server_mode')}
                      onSelect={(v) => handleChange('dev_server_mode', selectStoredValue('dev_server_mode', v))}
                      isOpen={openSelect === 'dev_server_mode'}
                      onToggle={() => setOpenSelect(openSelect === 'dev_server_mode' ? null : 'dev_server_mode')}
                      onClose={() => setOpenSelect(null)}
                      focusIndex={openSelect === 'dev_server_mode' ? optionFocusedIndex : null}
                      theme={theme}
                      ariaLabel="Test Server Mode"
                    />
                  </label>
                )}

                <label className={`options-row ${isRowFocused('dev_server_lan_session') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
                  <div className="options-row-label">
                    <strong>{t('options.devserver.lansession')}</strong>
                    <span>{t('options.devserver.lansession.desc')}</span>
                  </div>
                  <input
                    type="text"
                    className="options-text-input"
                    data-options-input="dev_server_lan_session"
                    value={valueOf('dev_server_lan_session')}
                    onChange={(event) => setSetting('dev_server_lan_session', event.target.value)}
                    onMouseEnter={handleHover}
                    maxLength={256}
                    spellCheck={false}
                    placeholder="Blank = listing only"
                  />
                </label>
              </div>
            )}

            <label className={`options-row ${isRowFocused('rtm_mode') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
              <div className="options-row-label">
                <strong>{t('options.advancedrtm')}</strong>
                <span>{t('options.advancedrtm.desc')}</span>
              </div>
              <span className={`options-toggle ${valueOf('rtm_mode') ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={Boolean(valueOf('rtm_mode'))}
                  onChange={(event) => {
                    playSound(selectSound)
                    setSetting('rtm_mode', event.target.checked)
                  }}
                  onMouseEnter={handleHover}
                  aria-label="Advanced RTM Mode"
                />
                <span className="options-toggle-track" aria-hidden="true" />
              </span>
            </label>
          </div>
        )}

        {section === 'about' && (
          <div className="options-card options-about-card">
            <h3>APPLICATION</h3>

            <div className="options-about-header">
              <h2>Legacy Modern Warfare III Launcher v{APP_VERSION}</h2>
            </div>

            <div className="options-about-section">
              <p className="options-about-copyright">
                &copy; 2026 Beanstalk313. All Rights Reserved.
              </p>
              <p>
                All application assets&mdash;excluding specific art and sound effects (SFX)&mdash;are the exclusive property of Beanstalk313. Unauthorized use, reproduction, or distribution violates applicable copyright laws and may result in civil and legal liability.
              </p>
              <p className="options-about-dist">
                <strong>Distribution Exception:</strong> Distribution is strictly permitted solely within the
                {' '}<a href="https://discord.gg/wz3" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>HINA'S WZ3 MOD Discord server</a>. Redirection, re-hosting, or sharing of this application in any other digital location, community, or platform is strictly prohibited.
              </p>
            </div>

            <h3>CREDITS</h3>

            <div className="options-about-section">
              <div className="options-about-credit">
                <strong>Project HiNAtyu (Hina)</strong>
                <p>Without Hina's work, the Warzone III mod wouldn't exist, and without her RTM tool&mdash;which is how I learned what files to make&mdash;this app would be much more unstable.</p>
              </div>
              <div className="options-about-credit">
                <strong>X J, jaxnami</strong>
                <p>Without their support and encouragement, I doubt I would've had the motivation to finish this project.</p>
              </div>
              <div className="options-about-credit">
                <strong>Infinity Ward, Sledgehammer</strong>
                <p>They created the sound effects, images, and, of course, the games we play. We're sorry Activision is your boss.</p>
              </div>
            </div>
          </div>
        )}

        <div className="options-reset-row">
          <button type="button" className={`options-reset-btn ${isResetFocused() ? 'controller-focused' : ''}`} onMouseEnter={handleHover} onClick={handleReset}>
            {t('options.reset')}
          </button>
          <span className="options-reset-hint">{t('options.reset.desc')}</span>
        </div>
      </div>
    </div>
  )
}