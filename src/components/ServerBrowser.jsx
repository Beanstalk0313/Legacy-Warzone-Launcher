import React, { useEffect, useMemo, useState } from 'react'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase'
import { useJupiterSession } from '../utils/jupiterSession'
import { useAuth } from './AuthProvider'
import { useSettings } from './SettingsProvider'
import JupiterErrorModal from './JupiterErrorModal'
import { isServerLeaseFresh, unregisterOwnedServer } from '../utils/serverPresence'
import { buildDevServer } from '../utils/devServer'

const regions = ['All Regions', 'North America', 'Europe', 'Asia Pacific']

// Live lobbies are pulled from Supabase on mount. The servers RLS policy
// (migration 0003) lets anyone — signed in or not — read public lobbies,
// plus each host's own private ones. Host display names come from the
// public `profile_names` view, which exposes only user_id +
// username/display_name (no emails, no Discord ids).
//
// Each interface only sees its own mod's lobbies: the `mod` column
// (migration 0007) is 'jupiter' or 'iw8', and this browser filters on it
// client-side so a missing migration degrades to an empty list instead of
// an API error.
// `theme` is the SHELL style (which mod's UI chrome is drawn — drives CSS
// classes, sounds, and whether the in-view Back button is hidden behind the
// shell's header back arrow). `mod` is the CONTENT mod (which mod's lobbies
// are listed and whether the join flow is the Jupiter RTM sequence or the
// IW8 stub). They're decoupled so Dynamic Interfaces can swap the shell
// without changing the content.
export default function ServerBrowser({ theme = 'iw8', mod = theme, onBack, initialInputMode = 'mouse' }) {
  const isJupiterStyle = theme === 'jupiter'
  const isJupiterContent = mod === 'jupiter'
  const hoverSound = isJupiterStyle ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiterStyle ? 'jupSelect' : 'iw8Select'
  const { user } = useAuth()
  const { settings } = useSettings()
  // Jupiter content only: the session provider owns the join flow + join
  // modal. IW8 content renders without a provider, so this hook returns null.
  const session = useJupiterSession()
  const [search, setSearch] = useState('')
  const [region, setRegion] = useState('All Regions')
  const [inputMode, setInputMode] = useState(initialInputMode)
  const [hoveredIndex, setHoveredIndex] = useState(null)
  const [servers, setServers] = useState([])
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED)
  const [loadError, setLoadError] = useState(null)
  const [status, setStatus] = useState(
    SUPABASE_CONFIGURED ? 'Loading lobbies…' : 'Server list pending backend connection.'
  )
  const [errorModal, setErrorModal] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const contentMod = isJupiterContent ? 'jupiter' : 'iw8'

  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !supabase) return
    let mounted = true
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('servers')
          .select('*')
          .order('created_at', { ascending: false })
        if (error) throw error
        // A dead host can remain visible for at most one Cron tick. Filter
        // the lease client-side too so the browser reacts immediately.
        const rows = (data || []).filter((row) => row.mod === contentMod && isServerLeaseFresh(row))

        // Resolve host labels from the public profile_names view (one
        // extra query for the distinct hosts in the list).
        const hostIds = [...new Set(rows.map((row) => row.host_user_id).filter(Boolean))]
        const hostNames = {}
        if (hostIds.length > 0) {
          const { data: profiles, error: profileError } = await supabase
            .from('profile_names')
            .select('user_id, username, display_name')
            .in('user_id', hostIds)
          if (!profileError && profiles) {
            for (const profile of profiles) {
              hostNames[profile.user_id] = profile.username || profile.display_name || null
            }
          }
        }

        // Real player counts come from server_members (migration 0007).
        // Guarded so an un-migrated DB just falls back to players_current.
        const serverIds = rows.map((row) => row.id)
        const memberCounts = {}
        if (serverIds.length > 0) {
          try {
            const { data: members } = await supabase
              .from('server_members')
              .select('server_id')
              .in('server_id', serverIds)
            for (const member of members || []) {
              memberCounts[member.server_id] = (memberCounts[member.server_id] || 0) + 1
            }
          } catch (memberCountError) {
            console.warn('[browser] member counts unavailable', memberCountError)
          }
        }

        if (!mounted) return
        setServers(
          rows.map((row) => ({
            id: row.id,
            name: row.name,
            host: hostNames[row.host_user_id] || 'Host',
            region: row.region || '—',
            version: row.version,
            map: row.map,
            mode: row.mode,
            players: `${memberCounts[row.id] ?? row.players_current ?? 0}`,
            ownerId: row.host_user_id,
            // Keep the actual session token: Jupiter sends this exact value
            // to the provider when the row is selected (it writes the join
            // trigger files).
            lanSession: typeof row.lan_session === 'string' ? row.lan_session.trim() : '',
          }))
        )
        setLoading(false)
        setStatus(
          rows.length
            ? `${rows.length} ${rows.length === 1 ? 'lobby' : 'lobbies'} online.`
            : 'No lobbies hosted yet — Host a Match to get yours listed.'
        )
      } catch (err) {
        if (!mounted) return
        setLoading(false)
        setLoadError(err?.message || 'Failed to load servers.')
        setStatus(`Couldn't reach the server list: ${err?.message || 'unknown error'}.`)
      }
    })()
    return () => {
      mounted = false
    }
  }, [contentMod])

  // Developer Mode (Jupiter content only): a synthetic, LOCAL-ONLY test
  // server row (built by buildDevServer — Quick Play uses the same builder
  // so both entry points treat it identically). It never touches Supabase
  // and no other client can see it.
  const devServer = isJupiterContent ? buildDevServer(settings) : null

  // Client-side filtering over the loaded list — the search box matches
  // name / map / mode / host, and the region dropdown is exact-match
  // (rows without a region only appear under All Regions). The dev server
  // rides along at the top of the list when Developer Mode is on.
  const filteredServers = useMemo(() => {
    const query = search.trim().toLowerCase()
    const rows = devServer ? [devServer, ...servers] : servers
    return rows.filter((server) => {
      const regionMatches = region === 'All Regions' || server.region === region
      const searchMatches =
        !query ||
        server.name.toLowerCase().includes(query) ||
        server.map.toLowerCase().includes(query) ||
        server.mode.toLowerCase().includes(query) ||
        server.host.toLowerCase().includes(query)
      return regionMatches && searchMatches
    })
  }, [servers, devServer, search, region])

  const handleBrowserBack = (source = 'mouse') => {
    playSound(selectSound)
    onBack?.(source)
  }

  const handleRegionHover = () => {
    setInputMode('mouse')
    setHoveredIndex(null)
    playSound(hoverSound)
  }

  const handleSearchHover = () => {
    setInputMode('mouse')
    setHoveredIndex(null)
    playSound(hoverSound)
  }

  const handleRegionChange = (event) => {
    playSound(selectSound)
    setRegion(event.target.value)
    setInputMode('mouse')
    setHoveredIndex(null)
  }

  const handleJoinServer = async (server) => {
    setInputMode('mouse')
    setHoveredIndex(null)

    // IW8 content has no Jupiter session provider — its join is a stub line.
    if (!isJupiterContent) {
      setStatus(`Joining ${server.name} — ${server.lanSession ? 'LAN session' : 'online'}…`)
      playSound(selectSound)
      return
    }

    if (session?.join) return

    // The provider runs the full RTM trigger sequence (lua ×3 with waits →
    // guided PHA modal → cbuf + join) and shows the join modal globally.
    // The dev server goes through the exact same flow as a real lobby —
    // the only difference is that without a LAN session the provider
    // skips the map/mode cbuf and the -join (nothing to send or connect
    // to) — see JupiterSessionProvider.
    await session.beginJoin(server, 'browser')
  }

  const handleDeleteServer = async (event, server) => {
    event.stopPropagation()
    if (!user || server.ownerId !== user.id || deletingId) return

    setDeletingId(server.id)
    try {
      const { error } = await supabase.from('servers').delete().eq('id', server.id).eq('host_user_id', user.id)
      if (error) throw error
      unregisterOwnedServer(server.id)
      setServers((current) => current.filter((entry) => entry.id !== server.id))
      setStatus(`${server.name} removed.`)
    } catch (error) {
      setErrorModal({
        title: `COULDN'T REMOVE ${server.name}`,
        message: error?.message || String(error) || 'Server deletion failed.',
      })
    } finally {
      setDeletingId(null)
    }
  }

  const handleSearchKeyDown = (event) => {
    if (event.key === 'Enter') {
      playSound(selectSound)
      setStatus(filteredServers.length
        ? `Showing ${filteredServers.length} ${filteredServers.length === 1 ? 'lobby' : 'lobbies'}.`
        : 'No lobbies match those filters.')
    }
  }

  const focusedIndex = useControllerNavigation({
    itemCount: filteredServers.length,
    allowedDirections: ['up', 'down'],
    onControllerActivity: () => setInputMode('controller'),
    onMove: (index) => {
      setInputMode('controller')
      setHoveredIndex(null)
      setStatus(filteredServers[index] ? `${filteredServers[index].name} selected` : 'No lobbies match those filters')
      playSound(hoverSound)
    },
    onConfirm: (index) => {
      const server = filteredServers[index]
      if (!server) return
      setInputMode('controller')
      void handleJoinServer(server)
    },
    enabled: !errorModal && !session?.join,
    onBack: handleBrowserBack,
  })

  const handleMouseEnter = (index) => {
    setInputMode('mouse')
    setHoveredIndex(index)
    setStatus(`${filteredServers[index].name} selected`)
    playSound(hoverSound)
  }

  const handleServerClick = (server) => {
    void handleJoinServer(server)
  }

  return (
    <section className={`server-browser ${isJupiterStyle ? 'server-browser-jupiter' : 'server-browser-iw8'}`}>
      <div className="server-browser-topline">
        <div>
          <span className="server-browser-kicker">PLAY / COMMUNITY</span>
          <h1>SERVER BROWSER</h1>
          <p>Find a lobby, check the rules, and deploy with your squad.</p>
        </div>
        {/* Jupiter shells hide the in-view Back button — the header back
            arrow returns to the main menu instead. IW8 shells keep it. Esc /
            controller Back still works on both. */}
        {!isJupiterStyle && (
          <button type="button" className="server-browser-back" onMouseEnter={handleRegionHover} onClick={() => handleBrowserBack('mouse')}>Back</button>
        )}
      </div>

      <div className="server-browser-toolbar">
        <label className="server-browser-search">
          <span>Search</span>
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setInputMode('mouse')
              setHoveredIndex(null)
            }}
            onMouseEnter={handleSearchHover}
            onKeyDown={(event) => {
              event.stopPropagation()
              // The controller hook ignores keys while an input is focused,
              // so Esc from the search box still steps back to the menu.
              if (event.key === 'Escape') {
                handleBrowserBack('keyboard')
                return
              }
              handleSearchKeyDown(event)
            }}
            placeholder="Search servers, maps, or hosts"
            aria-label="Search servers"
          />
        </label>
        <label className="server-browser-region">
          <span>Region</span>
          <select
            value={region}
            onChange={handleRegionChange}
            onMouseEnter={handleRegionHover}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {regions.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
        <div className="server-browser-count">
          <strong>{filteredServers.length}</strong>
          <span>LOBBIES FOUND</span>
        </div>
      </div>

      <div className="server-browser-status-line">{status}</div>

      <div className="server-browser-content">
        <div className="server-browser-list" role="listbox" aria-label="Available servers">
          <div className="server-browser-list-header">
            <span>Server</span>
            {!isJupiterContent && <span>Version</span>}
            <span>Map / Mode</span>
            <span>Players</span>
          </div>
          {filteredServers.length === 0 && (
            <div className="server-browser-empty">
              {!SUPABASE_CONFIGURED
                ? 'Server list pending backend connection.'
                : loading
                  ? 'Loading lobbies…'
                  : loadError
                    ? 'Couldn\'t load the server list.'
                    : servers.length === 0
                      ? 'No lobbies hosted yet — Host a Match to get yours listed.'
                      : 'No lobbies match those filters.'}
            </div>
          )}
          {filteredServers.map((server, index) => {
            const isFocused = inputMode === 'controller' && focusedIndex === index
            const isHovered = inputMode === 'mouse' && hoveredIndex === index
            return (
              <div
                role="option"
                aria-selected={isFocused || isHovered}
                tabIndex={0}
                key={server.id}
                className={`server-browser-row ${isFocused || isHovered ? 'active' : ''}`}
                onMouseEnter={() => handleMouseEnter(index)}
                onClick={() => handleServerClick(server)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') handleServerClick(server)
                }}
              >
                <span className="server-browser-server-name">
                  <strong>
                    {server.name}
                    {server.isDevServer && <span className="server-browser-dev-badge">DEV</span>}
                  </strong>
                  <small>{server.host} · {server.region}</small>
                </span>
                {!isJupiterContent && <span className="server-browser-version">{server.version}</span>}
                <span className="server-browser-map-mode">
                  <strong>{server.map}</strong>
                  <small>{server.mode}</small>
                </span>
                <span className="server-browser-players">{server.players}</span>
                {user?.id === server.ownerId && (
                  <button
                    type="button"
                    className="server-browser-delete"
                    onMouseEnter={() => playSound(hoverSound)}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        void handleDeleteServer(event, server)
                      }
                    }}
                    onClick={(event) => void handleDeleteServer(event, server)}
                    disabled={deletingId === server.id}
                  >
                    {deletingId === server.id ? 'Removing…' : 'Delete'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <JupiterErrorModal
        theme={theme}
        isOpen={Boolean(errorModal)}
        title={errorModal?.title}
        message={errorModal?.message}
        onClose={() => setErrorModal(null)}
      />
    </section>
  )
}
