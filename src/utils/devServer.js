// Shared builder for the Testing Server synthetic test server (Jupiter
// content only). The Testing Server toggle (Options > TESTING & RTM)
// creates a LOCAL-ONLY lobby row: it never touches Supabase, no other
// client can see it, and its metadata comes straight from settings (name /
// map / mode / LAN session).
//
// Both the Server Browser and Quick Play build the row from this one helper
// so every entry point treats the test server identically to a real lobby —
// the only behavioral difference lives in JupiterSessionProvider, which
// skips the map/mode config cbuf (and the -join) when no LAN session is
// configured, since there is nothing to send or connect to.
export function buildDevServer(settings, gameMode = 'warzone') {
  if (!settings || !settings.testing_server) return null
  return {
    id: 'dev-server',
    name: settings.dev_server_name || 'Local Test Server',
    host: 'LOCAL DEV',
    region: '—',
    version: 'DEV',
    // The dev server belongs to the CURRENT mode (its map/mode selects in
    // Options follow the same per-mode lists), so the join flow knows
    // whether the exec-hash config cbuf applies (warzone only).
    gameMode,
    map: settings.dev_server_map || 'Rebirth Island',
    mode: settings.dev_server_mode || 'Resurgence',
    players: '—',
    ownerId: null,
    lanSession:
      typeof settings.dev_server_lan_session === 'string'
        ? settings.dev_server_lan_session.trim()
        : '',
    isDevServer: true,
  }
}
