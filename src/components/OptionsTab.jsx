import React, { useEffect, useMemo, useState } from 'react'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { focusTextInput } from '../utils/keyboard'
import { useSettings } from './SettingsProvider'
import { JUPITER_MAPS, JUPITER_MODES } from '../utils/jupiterCommands'
import InterfaceReloadModal from './InterfaceReloadModal'
import CustomSelect from './CustomSelect'

const DYNAMIC_OPTIONS = [
  { value: 'enabled', label: 'Enabled' },
  { value: 'iw8', label: 'IW8 Mod' },
  { value: 'jupiter', label: 'Jupiter Mod' },
]

const DISPLAY_MODE_OPTIONS = [
  { value: 'fullscreen', label: 'Fullscreen' },
  { value: 'windowed', label: 'Windowed' },
]

export default function OptionsTab({ theme = 'iw8', onModalChange }) {
  const isJupiter = theme === 'jupiter'
  const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'
  const { settings, setSetting, resetSettings, getResetDefaults } = useSettings()
  // Options > Dynamic Interfaces (and Reset, when it would swap the shell)
  // re-renders the WHOLE interface — the old screen disappears on the spot.
  // Instead of snapping mid-click, the change is deferred behind a themed
  // confirmation modal. pendingInterface holds the target shell value;
  // isResetPending remembers whether confirm should run resetSettings()
  // rather than setSetting('dynamic_interfaces', …).
  const [pendingInterface, setPendingInterface] = useState(null)
  const [isResetPending, setIsResetPending] = useState(false)
  // Controller mode + the dropdown that's expanded (null = closed). The
  // dropdown's option list becomes the controller nav target while open
  // (the options hook below) — same pattern as Host a Match.
  const [inputMode, setInputMode] = useState('mouse')
  const [openSelect, setOpenSelect] = useState(null)

  // While the interface-reload confirmation OR a settings dropdown is open,
  // the parent interface's controller nav must go quiet (mirrors the modal
  // gating ModdingTab uses) — Esc/B would otherwise jump back to Play mid-
  // interaction. Released on unmount.
  useEffect(() => {
    onModalChange?.(Boolean(pendingInterface || openSelect))
    return () => onModalChange?.(false)
  }, [onModalChange, pendingInterface, openSelect])

  const handleHover = () => playSound(hoverSound)

  const handleChange = (key, value) => {
    playSound(selectSound)
    if (key === 'dynamic_interfaces') {
      setPendingInterface(value)
      setIsResetPending(false)
      return
    }
    setSetting(key, value)
  }

  const confirmInterfaceReload = () => {
    // The modal already played the select cue on button press — don't
    // double-play here.
    const wasReset = isResetPending
    const target = pendingInterface
    setPendingInterface(null)
    setIsResetPending(false)
    if (wasReset) {
      resetSettings()
    } else if (target) {
      setSetting('dynamic_interfaces', target)
    }
  }

  const cancelInterfaceReload = () => {
    setPendingInterface(null)
    setIsResetPending(false)
  }

  const handleReset = () => {
    playSound(selectSound)
    const defaults = getResetDefaults()
    // A reset that would swap the interface shell gets the same
    // confirmation modal as the dropdown — otherwise the whole screen
    // snaps without warning. (The select value stays on the current
    // settings until the reset is actually committed.)
    if (defaults.dynamic_interfaces !== settings.dynamic_interfaces) {
      setPendingInterface(defaults.dynamic_interfaces)
      setIsResetPending(true)
      return
    }
    resetSettings()
  }

  const valueOf = (key) => settings?.[key]
  const devModeOn = Boolean(valueOf('developer_mode'))

  // ── Controller navigation items (the tab's rows, top to bottom) ────────
  const navItems = useMemo(() => {
    const items = [
      { kind: 'select', key: 'display_mode', label: 'Display Mode' },
      { kind: 'toggle', key: 'auto_load_savedata', label: 'Auto-Load Save Data' },
      { kind: 'select', key: 'dynamic_sounds', label: 'Dynamic Sound Effects' },
      { kind: 'select', key: 'dynamic_interfaces', label: 'Dynamic Interfaces' },
      { kind: 'toggle', key: 'developer_mode', label: 'Developer Mode' },
      ...(devModeOn ? [
        { kind: 'text', key: 'dev_server_name', label: 'Dev Server Name' },
        { kind: 'select', key: 'dev_server_map', label: 'Dev Server Map' },
        { kind: 'select', key: 'dev_server_mode', label: 'Dev Server Mode' },
        { kind: 'text', key: 'dev_server_lan_session', label: 'Dev Server LAN Session' },
      ] : []),
      { kind: 'reset', label: 'Reset to Defaults' },
    ]
    return items
  }, [devModeOn])

  // Select field plumbing: options are display strings for the picker; the
  // stored value for {value,label} lists is the `value` half.
  const selectOptions = (key) => {
    if (key === 'display_mode') return DISPLAY_MODE_OPTIONS.map((option) => option.label)
    if (key === 'dynamic_sounds' || key === 'dynamic_interfaces') return DYNAMIC_OPTIONS.map((option) => option.label)
    if (key === 'dev_server_map') return JUPITER_MAPS
    if (key === 'dev_server_mode') return JUPITER_MODES
    return []
  }
  const selectStoredValue = (key, display) => {
    const opts = key === 'display_mode'
      ? DISPLAY_MODE_OPTIONS
      : (key === 'dynamic_sounds' || key === 'dynamic_interfaces') ? DYNAMIC_OPTIONS : null
    return opts?.find((option) => option.label === display)?.value ?? display
  }
  const selectDisplay = (key) => {
    const stored = valueOf(key)
    const opts = key === 'display_mode'
      ? DISPLAY_MODE_OPTIONS
      : (key === 'dynamic_sounds' || key === 'dynamic_interfaces') ? DYNAMIC_OPTIONS : null
    return opts?.find((option) => option.value === stored)?.label ?? stored
  }

  const openOptions = openSelect ? selectOptions(openSelect) : []
  const openCurrentDisplay = openSelect ? selectDisplay(openSelect) : ''

  // Rows hook — navigates the tab's rows; a select opens its dropdown, a
  // toggle flips, a text field hands off to the on-screen keyboard.
  const focusedIndex = useControllerNavigation({
    itemCount: navItems.length,
    allowedDirections: ['up', 'down'],
    onControllerActivity: () => setInputMode('controller'),
    onMove: (index) => {
      setInputMode('controller')
      playSound(hoverSound)
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
      if (item.kind === 'reset') handleReset()
    },
    enabled: pendingInterface === null && !openSelect,
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
    enabled: Boolean(openSelect) && pendingInterface === null,
  })

  const isRowFocused = (key) => inputMode === 'controller' && navItems[focusedIndex]?.key === key
  const isResetFocused = () => inputMode === 'controller' && navItems[focusedIndex]?.kind === 'reset'

  return (
    <div className={`tab-content-panel ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
      <div className="tab-header-title">
        <h2>OPTIONS</h2>
        <span className="tab-subtitle">Launcher preferences — saved to Documents\retdonetskmod\settings.json</span>
      </div>

      <div className="options-sections">
        <div className="options-card">
          <h3>GENERAL</h3>

          <label className={`options-row ${isRowFocused('display_mode') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
            <div className="options-row-label">
              <strong>Display Mode</strong>
              <span>Choose fullscreen for the standard command-center view or windowed for a resizable desktop window.</span>
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

          <label className={`options-row ${isRowFocused('auto_load_savedata') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
            <div className="options-row-label">
              <strong>Auto-Load Save Data</strong>
              <span>Runs RTM.exe -loaddata every time the Jupiter interface opens — restores your classes, operator, and settings automatically.</span>
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

          <label className={`options-row ${isRowFocused('dynamic_sounds') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
            <div className="options-row-label">
              <strong>Dynamic Sound Effects</strong>
              <span>Force one mod's sound effects everywhere, or keep them dynamic per theme.</span>
            </div>
            <CustomSelect
              value={selectDisplay('dynamic_sounds')}
              options={selectOptions('dynamic_sounds')}
              onSelect={(display) => handleChange('dynamic_sounds', selectStoredValue('dynamic_sounds', display))}
              isOpen={openSelect === 'dynamic_sounds'}
              onToggle={() => setOpenSelect(openSelect === 'dynamic_sounds' ? null : 'dynamic_sounds')}
              onClose={() => setOpenSelect(null)}
              focusIndex={openSelect === 'dynamic_sounds' ? optionFocusedIndex : null}
              theme={theme}
              ariaLabel="Dynamic Sound Effects"
            />
          </label>

          <label className={`options-row ${isRowFocused('dynamic_interfaces') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
            <div className="options-row-label">
              <strong>Dynamic Interfaces</strong>
              <span>Swap the whole launcher interface to the other mod's style — functionality stays the same.</span>
            </div>
            <CustomSelect
              value={selectDisplay('dynamic_interfaces')}
              options={selectOptions('dynamic_interfaces')}
              onSelect={(display) => handleChange('dynamic_interfaces', selectStoredValue('dynamic_interfaces', display))}
              isOpen={openSelect === 'dynamic_interfaces'}
              onToggle={() => setOpenSelect(openSelect === 'dynamic_interfaces' ? null : 'dynamic_interfaces')}
              onClose={() => setOpenSelect(null)}
              focusIndex={openSelect === 'dynamic_interfaces' ? optionFocusedIndex : null}
              theme={theme}
              ariaLabel="Dynamic Interfaces"
            />
          </label>

        </div>

        {/* Developer Mode — unlocks the raw RTM tool panel on the PHA
            Client tab and a LOCAL-ONLY test server in the Server Browser.
            The test server never touches Supabase and no other client can
            see it; everything below is persisted to settings.json. */}
        <div className="options-card">
          <h3>DEVELOPER</h3>

          <label className={`options-row ${isRowFocused('developer_mode') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
            <div className="options-row-label">
              <strong>Developer Mode</strong>
              <span>Unlocks the full RTM tool panel on the PHA Client tab and lists a local test server in the Server Browser — not a real lobby, invisible to other clients.</span>
            </div>
            <span className={`options-toggle ${valueOf('developer_mode') ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={Boolean(valueOf('developer_mode'))}
                onChange={(event) => {
                  playSound(selectSound)
                  setSetting('developer_mode', event.target.checked)
                }}
                onMouseEnter={handleHover}
                aria-label="Developer Mode"
              />
              <span className="options-toggle-track" aria-hidden="true" />
            </span>
          </label>

          {devModeOn && (
            <div className="options-dev-fields">
              <label className={`options-row ${isRowFocused('dev_server_name') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
                <div className="options-row-label">
                  <strong>Dev Server Name</strong>
                  <span>The name shown for the local test server in the Server Browser.</span>
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
                  <strong>Dev Server Map</strong>
                  <span>The map the test server reports — drives the join config command.</span>
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
                  ariaLabel="Dev Server Map"
                />
              </label>

              <label className={`options-row ${isRowFocused('dev_server_mode') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
                <div className="options-row-label">
                  <strong>Dev Server Mode</strong>
                  <span>The mode the test server reports — drives the join config command.</span>
                </div>
                <CustomSelect
                  value={selectDisplay('dev_server_mode')}
                  options={selectOptions('dev_server_mode')}
                  onSelect={(display) => handleChange('dev_server_mode', selectStoredValue('dev_server_mode', display))}
                  isOpen={openSelect === 'dev_server_mode'}
                  onToggle={() => setOpenSelect(openSelect === 'dev_server_mode' ? null : 'dev_server_mode')}
                  onClose={() => setOpenSelect(null)}
                  focusIndex={openSelect === 'dev_server_mode' ? optionFocusedIndex : null}
                  theme={theme}
                  ariaLabel="Dev Server Mode"
                />
              </label>

              <label className={`options-row ${isRowFocused('dev_server_lan_session') ? 'controller-focused' : ''}`} onMouseEnter={handleHover}>
                <div className="options-row-label">
                  <strong>Dev Server LAN Session</strong>
                  <span>Optional — paste a LAN session code to make the test server joinable. Leave blank for a listing-only row.</span>
                </div>
                <input
                  type="text"
                  className="options-text-input"
                  data-options-input="dev_server_lan_session"
                  value={valueOf('dev_server_lan_session')}
                  onChange={(event) => setSetting('dev_server_lan_session', event.target.value)}
                  onMouseEnter={handleHover}
                  maxLength={64}
                  spellCheck={false}
                  placeholder="Blank = listing only"
                />
              </label>
            </div>
          )}
        </div>

        <div className="options-reset-row">
          <button type="button" className={`options-reset-btn ${isResetFocused() ? 'controller-focused' : ''}`} onMouseEnter={handleHover} onClick={handleReset}>
            Reset to Defaults
          </button>
          <span className="options-reset-hint">Restores the settings this session launched with.</span>
        </div>
      </div>

      <InterfaceReloadModal
        theme={theme}
        targetMod={pendingInterface}
        isOpen={pendingInterface !== null}
        onConfirm={confirmInterfaceReload}
        onCancel={cancelInterfaceReload}
      />
    </div>
  )
}
