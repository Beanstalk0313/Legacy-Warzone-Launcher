import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { focusTextInput } from '../utils/keyboard'
import { useAuth } from './AuthProvider'
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase'
import { getDisplayName } from '../utils/displayName'

// Social tab — friends + party management.
//
// Friends live in the `friendships` table (migration 0001): one row per
// friendship, owned by the user who sent the request (user_id = sender,
// friend_id = recipient, status pending/accepted). Adding a friend inserts a
// PENDING row; the recipient accepts it (deletes the sender's pending row and
// inserts their own accepted row — RLS only lets a user touch their own rows,
// so the relationship ends up as a single accepted row either way).
//
// Parties (migration 0007) use an invite code: the leader creates the party,
// shares the 6-char code, and anyone (friend or not) can join. Migration 0008
// opened `parties` SELECT to any authenticated user when the row has an
// invite_code, which is what makes join-by-code work. Leaders can also invite
// friends directly; the invitee gets a themed toast notification (see
// JupiterSessionProvider) plus a pending list here.

// Module-level cache for the fetched data (friends / nicknames / party /
// invites). The interfaces render tab content inside a keyed container
// (key = active tab), so EVERY tab switch unmounts and remounts SocialTab
// — without a cache each visit would re-fetch everything from scratch. The
// cache is per-user and considered fresh for a short TTL, so switching back
// to the tab within that window renders instantly with no fetch; the 10 s
// poll below keeps it fresh while the tab is open. Module memory resets on
// app reload, which is fine — a fresh launch has no stale squad anyway.
const socialCache = {
  userId: null,
  friends: null,
  party: null,
  partyInvites: null,
  nicknames: null,
  fetchedAt: 0,
}
const SOCIAL_CACHE_TTL_MS = 30000

export default function SocialTab({ theme = 'iw8', onSwitchToAccount }) {
  const { user } = useAuth()
  const isJupiter = theme === 'jupiter'
  const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'
  const myId = user?.id
  const configured = SUPABASE_CONFIGURED && supabase

  // Seed initial state from a fresh cache so a tab switch doesn't flash an
  // empty list before the (skipped) fetch would have populated it.
  const cacheFresh = myId !== undefined
    && socialCache.userId === myId
    && Date.now() - socialCache.fetchedAt < SOCIAL_CACHE_TTL_MS

  const [friends, setFriends] = useState(() => cacheFresh ? socialCache.friends : { accepted: [], incoming: [], outgoing: [] })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [party, setParty] = useState(() => cacheFresh ? socialCache.party : null) // { id, leaderUserId, inviteCode, members: [{userId, name}] }
  const [partyInvites, setPartyInvites] = useState(() => cacheFresh ? socialCache.partyInvites : [])
  const [partyCode, setPartyCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const searchTimerRef = useRef(null)
  // Personal nicknames I've set for friends: { friendId: nickname }.
  const [nicknames, setNicknames] = useState(() => cacheFresh ? socialCache.nicknames : {})
  // Right-click friend context menu: { x, y, friend } | null.
  const [friendMenu, setFriendMenu] = useState(null)
  // While true the context menu shows the destructive remove-confirm view.
  const [menuConfirm, setMenuConfirm] = useState(false)
  // Inline nickname editor: { friendId, value } | null.
  const [editingNick, setEditingNick] = useState(null)
  const menuRef = useRef(null)
  // Controller mode for the tab's own navigation (the right-click friend
  // context menu stays mouse-driven).
  const [inputMode, setInputMode] = useState('mouse')

  const handleHover = () => playSound(hoverSound)
  const handleSelect = () => playSound(selectSound)

  const avatarInitial = (name) => (name || '?').trim()[0]?.toUpperCase() || '?'

  // ── Data loading ────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!myId || !configured) return

    try {
      // Friends: all rows touching me, both directions.
      const { data: rows } = await supabase
        .from('friendships')
        .select('*')
        .or(`user_id.eq.${myId},friend_id.eq.${myId}`)
      const accepted = []
      const incoming = []
      const outgoing = []
      for (const row of rows || []) {
        if (row.status === 'accepted') {
          accepted.push(row.user_id === myId ? row.friend_id : row.user_id)
        } else if (row.status === 'pending') {
          if (row.friend_id === myId) incoming.push(row.user_id)
          else outgoing.push(row.friend_id)
        }
      }
      // My personal nicknames for friends — they override the gamertag
      // wherever the friend appears (friend list + party member list).
      const { data: nickRows } = await supabase
        .from('friend_nicknames')
        .select('friend_id, nickname')
        .eq('user_id', myId)
      const nickMap = {}
      for (const nickRow of nickRows || []) nickMap[nickRow.friend_id] = nickRow.nickname
      setNicknames(nickMap)
      const nameFor = async (ids) => {
        if (ids.length === 0) return []
        const { data: profiles } = await supabase
          .from('profile_names')
          .select('user_id, username, display_name')
          .in('user_id', ids)
        const map = {}
        for (const profile of profiles || []) map[profile.user_id] = profile.username || profile.display_name || 'Unknown'
        return ids.map((id) => ({ userId: id, name: nickMap[id] || map[id] || 'Unknown' }))
      }
      const [acceptedList, incomingList, outgoingList] = await Promise.all([
        nameFor(accepted),
        nameFor(incoming),
        nameFor(outgoing),
      ])
      const friendsData = { accepted: acceptedList, incoming: incomingList, outgoing: outgoingList }
      setFriends(friendsData)

      // Party: my membership → party row → members.
      const { data: memberships } = await supabase
        .from('party_members')
        .select('party_id')
        .eq('user_id', myId)
        .limit(1)
      const partyId = memberships?.[0]?.party_id
      let partyData = null
      if (partyId) {
        const { data: partyRow } = await supabase.from('parties').select('*').eq('id', partyId).single()
        if (partyRow) {
          const { data: memberRows } = await supabase
            .from('party_members')
            .select('user_id')
            .eq('party_id', partyId)
          const memberIds = (memberRows || []).map((member) => member.user_id)
          const memberNames = await nameFor(memberIds)
          const leaderProfile = memberNames.find((member) => member.userId === partyRow.leader_user_id)
          partyData = {
            id: partyId,
            leaderUserId: partyRow.leader_user_id,
            leaderName: leaderProfile?.name || 'Party leader',
            inviteCode: partyRow.invite_code,
            members: memberNames,
            leaderServerId: partyRow.leader_server_id,
          }
        }
      }
      setParty(partyData)

      // Pending party invites for me.
      const { data: invites } = await supabase
        .from('party_invites')
        .select('id, party_id, invited_by_user_id')
        .eq('invitee_user_id', myId)
        .eq('status', 'pending')
      const inviteList = await Promise.all((invites || []).map(async (invite) => {
        const { data: profile } = await supabase
          .from('profile_names')
          .select('username, display_name')
          .eq('user_id', invite.invited_by_user_id)
          .single()
        return {
          id: invite.id,
          partyId: invite.party_id,
          inviterName: profile?.username || profile?.display_name || 'A friend',
        }
      }))
      setPartyInvites(inviteList)

      // Store the snapshot for tab-switch remounts (see socialCache above).
      socialCache.userId = myId
      socialCache.friends = friendsData
      socialCache.party = partyData
      socialCache.partyInvites = inviteList
      socialCache.nicknames = nickMap
      socialCache.fetchedAt = Date.now()
    } catch (err) {
      console.warn('[social] refresh failed', err)
    }
  }, [configured, myId])

  useEffect(() => {
    if (!myId || !configured) return
    // Fresh cache → skip the mount-time fetch entirely (the poll below
    // keeps it fresh); stale/missing → fetch now so the list isn't empty.
    const fresh = socialCache.userId === myId
      && Date.now() - socialCache.fetchedAt < SOCIAL_CACHE_TTL_MS
    if (!fresh) void refresh()
    const interval = window.setInterval(() => void refresh(), 10000)
    return () => window.clearInterval(interval)
  }, [configured, myId, refresh])

  // ── Add friend search ───────────────────────────────────────────────────
  const handleSearchChange = (value) => {
    setSearchQuery(value)
    setNotice(null)
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current)
    const query = value.trim()
    if (!query) {
      setSearchResults([])
      return
    }
    searchTimerRef.current = window.setTimeout(async () => {
      setSearching(true)
      try {
        // Match gamertag OR fallback display name (older accounts may not
        // have a username). `%` / `_` are LIKE wildcards — strip them so a
        // search can't match everything.
        const safeQuery = query.replace(/[%_]/g, '')
        if (!safeQuery) {
          setSearchResults([])
          return
        }
        const { data } = await supabase
          .from('profile_names')
          .select('user_id, username, display_name')
          .or(`username.ilike.%${safeQuery}%,display_name.ilike.%${safeQuery}%`)
          .limit(8)
        setSearchResults((data || [])
          .filter((profile) => profile.user_id !== myId)
          .map((profile) => ({ userId: profile.user_id, name: profile.username || profile.display_name || 'Unknown' })))
      } catch (err) {
        console.warn('[social] search failed', err)
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 400)
  }

  const handleAddFriend = async (profile) => {
    if (!myId || busy) return
    handleSelect()
    setBusy(true)
    setNotice(null)
    let acceptedExisting = false
    try {
      // Check for an existing relationship in either direction.
      const { data: existing } = await supabase
        .from('friendships')
        .select('*')
        .or(`and(user_id.eq.${myId},friend_id.eq.${profile.userId}),and(user_id.eq.${profile.userId},friend_id.eq.${myId})`)

      if (existing && existing.length > 0) {
        const row = existing[0]
        if (row.status === 'accepted') {
          setNotice({ kind: 'error', text: `${profile.name} is already your friend.` })
          return
        }
        if (row.user_id === myId) {
          setNotice({ kind: 'error', text: `Friend request to ${profile.name} is already pending.` })
          return
        }
        // They already sent us a request → accept it: drop their pending row
        // and insert our own accepted row (RLS only lets us touch our rows).
        await supabase.from('friendships').delete().eq('id', row.id)
        acceptedExisting = true
      }
      // New request: insert a PENDING row owned by me; the recipient accepts
      // it from their INCOMING REQUESTS list.
      const { error } = await supabase.from('friendships').insert({
        user_id: myId,
        friend_id: profile.userId,
        status: acceptedExisting ? 'accepted' : 'pending',
      })
      if (error) throw error
      setNotice({
        kind: 'success',
        text: acceptedExisting
          ? `You are now friends with ${profile.name}.`
          : `Friend request sent to ${profile.name}.`,
      })
      setSearchResults([])
      setSearchQuery('')
      await refresh()
    } catch (err) {
      setNotice({ kind: 'error', text: err?.message || 'Could not send friend request.' })
    } finally {
      setBusy(false)
    }
  }

  const handleAcceptFriend = async (friend) => {
    if (!myId || busy) return
    handleSelect()
    setBusy(true)
    try {
      const { data: rows } = await supabase
        .from('friendships')
        .select('id')
        .eq('user_id', friend.userId)
        .eq('friend_id', myId)
        .eq('status', 'pending')
      for (const row of rows || []) {
        await supabase.from('friendships').delete().eq('id', row.id)
      }
      await supabase.from('friendships').insert({
        user_id: myId,
        friend_id: friend.userId,
        status: 'accepted',
      })
      await refresh()
    } catch (err) {
      setNotice({ kind: 'error', text: err?.message || 'Could not accept request.' })
    } finally {
      setBusy(false)
    }
  }

  const handleDeclineFriend = async (friend) => {
    if (!myId || busy) return
    handleSelect()
    setBusy(true)
    try {
      await supabase.from('friendships').delete().eq('user_id', friend.userId).eq('friend_id', myId)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  // ── Friend context menu (right-click / ⋯ button) ───────────────────────
  const openFriendMenu = (event, friend) => {
    event.preventDefault()
    handleSelect()
    setMenuConfirm(false)
    const pad = 8
    const menuWidth = 240
    const menuHeight = 260
    const x = Math.max(pad, Math.min(event.clientX, window.innerWidth - menuWidth - pad))
    const y = Math.max(pad, Math.min(event.clientY, window.innerHeight - menuHeight - pad))
    setFriendMenu({ x, y, friend })
  }

  const closeFriendMenu = () => {
    setFriendMenu(null)
    setMenuConfirm(false)
  }

  // While the menu is open: close on outside clicks, and intercept Esc /
  // Backspace on the CAPTURE phase so the interface-level back handler (a
  // window bubble listener) doesn't also jump back to the Play tab.
  useEffect(() => {
    if (!friendMenu) return undefined
    const onDocMouseDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) closeFriendMenu()
    }
    const onDocKeyDown = (event) => {
      if (event.key === 'Escape' || event.key.toLowerCase() === 'backspace') {
        event.preventDefault()
        event.stopPropagation()
        closeFriendMenu()
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onDocKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onDocKeyDown, true)
    }
  }, [friendMenu])

  const handleRemoveFriend = async (friend) => {
    if (!myId || busy) return
    handleSelect()
    setBusy(true)
    closeFriendMenu()
    try {
      // Either side of the friendship can delete the accepted row (RLS:
      // auth.uid() = user_id or auth.uid() = friend_id).
      await supabase
        .from('friendships')
        .delete()
        .or(`and(user_id.eq.${myId},friend_id.eq.${friend.userId}),and(user_id.eq.${friend.userId},friend_id.eq.${myId})`)
      // Nicknames are per-viewer — drop mine for them too.
      await supabase.from('friend_nicknames').delete().eq('user_id', myId).eq('friend_id', friend.userId)
      setNicknames((current) => {
        const next = { ...current }
        delete next[friend.userId]
        return next
      })
      setNotice({ kind: 'success', text: `${friend.name} was removed from your friends.` })
      await refresh()
    } catch (err) {
      setNotice({ kind: 'error', text: err?.message || 'Could not remove friend.' })
    } finally {
      setBusy(false)
    }
  }

  const startEditingNickname = (friend) => {
    handleSelect()
    setEditingNick({ friendId: friend.userId, value: nicknames[friend.userId] || '' })
    closeFriendMenu()
  }

  const handleSaveNickname = async (friend) => {
    const value = (editingNick?.value || '').trim()
    if (!myId || busy || !value) return
    handleSelect()
    setBusy(true)
    try {
      const { error } = await supabase
        .from('friend_nicknames')
        .upsert({ user_id: myId, friend_id: friend.userId, nickname: value }, { onConflict: 'user_id,friend_id' })
      if (error) throw error
      setNicknames((current) => ({ ...current, [friend.userId]: value }))
      setEditingNick(null)
      setNotice({ kind: 'success', text: `Nickname saved — ${friend.name} now shows as ${value}.` })
      await refresh()
    } catch (err) {
      setNotice({ kind: 'error', text: err?.message || 'Could not save nickname.' })
    } finally {
      setBusy(false)
    }
  }

  const handleClearNickname = async (friend) => {
    if (!myId || busy) return
    handleSelect()
    setBusy(true)
    closeFriendMenu()
    try {
      await supabase.from('friend_nicknames').delete().eq('user_id', myId).eq('friend_id', friend.userId)
      setNicknames((current) => {
        const next = { ...current }
        delete next[friend.userId]
        return next
      })
      setNotice({ kind: 'success', text: `Nickname cleared for ${friend.name}.` })
      await refresh()
    } catch (err) {
      setNotice({ kind: 'error', text: err?.message || 'Could not clear the nickname.' })
    } finally {
      setBusy(false)
    }
  }

  // ── Party actions ───────────────────────────────────────────────────────
  const generatePartyCode = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  }

  const handleCreateParty = async () => {
    if (!myId || busy) return
    handleSelect()
    setBusy(true)
    setNotice(null)
    try {
      let code = generatePartyCode()
      let result
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { data, error } = await supabase.from('parties').insert({
          leader_user_id: myId,
          invite_code: code,
        }).select('*').single()
        if (!error) { result = data; break }
        if (!/duplicate/i.test(error.message || '')) throw error
        code = generatePartyCode()
      }
      if (!result) throw new Error('Could not create the party.')
      await supabase.from('party_members').insert({ party_id: result.id, user_id: myId })
      await refresh()
      setNotice({ kind: 'success', text: `Party created — invite code: ${result.invite_code}` })
    } catch (err) {
      setNotice({ kind: 'error', text: err?.message || 'Could not create the party.' })
    } finally {
      setBusy(false)
    }
  }

  const handleJoinPartyByCode = async () => {
    const code = partyCode.trim().toUpperCase()
    if (!myId || busy || !code) return
    handleSelect()
    setBusy(true)
    setNotice(null)
    try {
      // Migration 0008 lets any authenticated user SELECT a party that has
      // an invite_code — without it, RLS hid the row from non-members and
      // join-by-code always failed with "No party found with that code."
      const { data: partyRow, error } = await supabase
        .from('parties')
        .select('id')
        .eq('invite_code', code)
        .single()
      if (error || !partyRow) throw new Error('No party found with that code.')
      // Leave any existing party first — a player follows one leader.
      await supabase.from('party_members').delete().eq('user_id', myId)
      await supabase.from('party_members').insert({ party_id: partyRow.id, user_id: myId })
      setPartyCode('')
      await refresh()
      setNotice({ kind: 'success', text: 'Party joined. When the leader joins a lobby, your client follows automatically.' })
    } catch (err) {
      setNotice({ kind: 'error', text: err?.message || 'Could not join the party.' })
    } finally {
      setBusy(false)
    }
  }

  const handleLeaveParty = async () => {
    if (!myId || busy || !party) return
    handleSelect()
    setBusy(true)
    try {
      if (party.leaderUserId === myId) {
        // Leaders disband the whole party (members + invites cascade).
        await supabase.from('parties').delete().eq('id', party.id)
      } else {
        await supabase.from('party_members').delete().eq('party_id', party.id).eq('user_id', myId)
      }
      setParty(null)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleInviteToParty = async (friend) => {
    if (!myId || busy || !party) return
    handleSelect()
    setBusy(true)
    setNotice(null)
    try {
      const { error } = await supabase.from('party_invites').insert({
        party_id: party.id,
        invited_by_user_id: myId,
        invitee_user_id: friend.userId,
      })
      if (error) {
        if (/duplicate/i.test(error.message || '')) {
          setNotice({ kind: 'error', text: `${friend.name} was already invited.` })
        } else {
          throw error
        }
      } else {
        setNotice({ kind: 'success', text: `Party invite sent to ${friend.name}.` })
      }
    } catch (err) {
      setNotice({ kind: 'error', text: err?.message || 'Could not invite friend.' })
    } finally {
      setBusy(false)
    }
  }

  const handleAcceptPartyInvite = async (invite) => {
    if (!myId || busy) return
    handleSelect()
    setBusy(true)
    try {
      await supabase.from('party_members').delete().eq('user_id', myId)
      await supabase.from('party_members').insert({ party_id: invite.partyId, user_id: myId })
      await supabase.from('party_invites').update({ status: 'accepted' }).eq('id', invite.id)
      await refresh()
    } catch (err) {
      setNotice({ kind: 'error', text: err?.message || 'Could not accept the invite.' })
    } finally {
      setBusy(false)
    }
  }

  const handleDeclinePartyInvite = async (invite) => {
    if (!myId || busy) return
    handleSelect()
    setBusy(true)
    try {
      await supabase.from('party_invites').update({ status: 'declined' }).eq('id', invite.id)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleCopyPartyCode = async () => {
    if (!party?.inviteCode) return
    handleSelect()
    try {
      await navigator.clipboard.writeText(party.inviteCode)
      setCodeCopied(true)
      window.setTimeout(() => setCodeCopied(false), 1800)
    } catch {
      setNotice({ kind: 'error', text: 'Could not copy the code — select and copy it manually.' })
    }
  }

  const handleSignUpClick = () => {
    if (typeof onSwitchToAccount === 'function') onSwitchToAccount()
  }

  const isLeader = party?.leaderUserId === myId

  // ── Controller navigation ────────────────────────────────────────────────
  // One flat, in-order list of the tab's primary controls (search box, add /
  // accept / decline buttons, party actions). Text fields hand off to the
  // on-screen keyboard; the right-click friend context menu stays mouse-only.
  // No onBack here — Esc / controller-Back on a non-Play tab is handled by
  // the interface hook (jumps back to the Play tab).
  const navItems = useMemo(() => {
    const items = []
    if (!user || !configured) return items
    items.push({ kind: 'search', label: 'Add Friend search' })
    for (const profile of searchResults) {
      items.push({ kind: 'addFriend', profile, label: `Add ${profile.name}` })
    }
    for (const friend of friends.incoming) {
      items.push({ kind: 'acceptFriend', friend, label: `Accept ${friend.name}` })
      items.push({ kind: 'declineFriend', friend, label: `Decline ${friend.name}` })
    }
    for (const friend of friends.accepted) {
      if (party && isLeader) items.push({ kind: 'inviteFriend', friend, label: `Invite ${friend.name}` })
    }
    for (const invite of partyInvites) {
      items.push({ kind: 'acceptInvite', invite, label: `Accept invite from ${invite.inviterName}` })
      items.push({ kind: 'declineInvite', invite, label: `Decline invite from ${invite.inviterName}` })
    }
    if (party) {
      items.push({ kind: 'copyCode', label: 'Copy invite code' })
      items.push({ kind: 'leaveParty', label: isLeader ? 'Disband Party' : 'Leave Party' })
    } else {
      items.push({ kind: 'createParty', label: 'Create Party' })
      items.push({ kind: 'partyCode', label: 'Party join code' })
      items.push({ kind: 'joinParty', label: 'Join Party' })
    }
    return items
  }, [user, configured, searchResults, friends, partyInvites, party, isLeader])

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
      switch (item.kind) {
        case 'search':
          focusTextInput('.social-add-search input', setInputMode)
          break
        case 'addFriend': void handleAddFriend(item.profile); break
        case 'acceptFriend': void handleAcceptFriend(item.friend); break
        case 'declineFriend': void handleDeclineFriend(item.friend); break
        case 'acceptInvite': void handleAcceptPartyInvite(item.invite); break
        case 'declineInvite': void handleDeclinePartyInvite(item.invite); break
        case 'inviteFriend': void handleInviteToParty(item.friend); break
        case 'copyCode': void handleCopyPartyCode(); break
        case 'leaveParty': void handleLeaveParty(); break
        case 'createParty': void handleCreateParty(); break
        case 'partyCode': focusTextInput('.social-party-code-field input', setInputMode); break
        case 'joinParty': void handleJoinPartyByCode(); break
        default: break
      }
    },
  })

  const isNavFocused = (predicate) => {
    if (inputMode !== 'controller') return false
    const item = navItems[focusedIndex]
    return Boolean(item && predicate(item))
  }

  const themeClass = isJupiter ? 'jupiter-theme' : 'iw8-theme'

  // ── Locked state (not signed in) ────────────────────────────────────────
  if (!user) {
    return (
      <div className={`tab-content-panel social-tab-panel ${themeClass}`}>
        <div className="tab-header-title">
          <h2>SOCIAL</h2>
          <span className="tab-subtitle">Friends &amp; Party Management</span>
        </div>
        <div className={`social-locked-state ${themeClass}`}>
          <h3 className="social-locked-title">You aren't signed in.</h3>
          <p className="social-locked-body">
            To access friends and parties, you'll need to sign in to an account.
          </p>
          <button
            type="button"
            className={`social-locked-cta ${themeClass}`}
            onClick={handleSignUpClick}
            onMouseEnter={() => playSound(hoverSound)}
          >
            Go to Sign Up
          </button>
        </div>
      </div>
    )
  }

  if (!configured) {
    return (
      <div className={`tab-content-panel social-tab-panel ${themeClass}`}>
        <div className="tab-header-title">
          <h2>SOCIAL</h2>
          <span className="tab-subtitle">Friends &amp; Party Management</span>
        </div>
        <div className="social-locked-state ${themeClass}">
          <h3 className="social-locked-title">Backend not configured.</h3>
          <p className="social-locked-body">Add your Supabase credentials to use friends and parties.</p>
        </div>
      </div>
    )
  }

  const totalFriends = friends.accepted.length

  return (
    <div className={`tab-content-panel social-tab-panel ${themeClass}`}>
      <div className="tab-header-title">
        <h2>SOCIAL</h2>
        <span className="tab-subtitle">{user ? getDisplayName(user) : 'Friends & Party Management'}</span>
      </div>

      {notice && (
        <div className={`social-notice social-notice-${notice.kind}`} role="status">
          {notice.text}
        </div>
      )}

      <div className="social-layout">
        {/* ── Friends column ─────────────────────────────────────────── */}
        <div className={`social-panel ${themeClass}`}>
          <div className="social-panel-head">
            <span className="social-panel-kicker">FRIENDS</span>
            {totalFriends > 0 && <span className="social-panel-count">{totalFriends}</span>}
          </div>

          <div className="social-add-friend">
            <label className="social-add-search">
              <span>Add Friend</span>
              <input
                className={`social-add-search-input ${isNavFocused((item) => item.kind === 'search') ? 'controller-focused' : ''}`}
                value={searchQuery}
                onChange={(event) => handleSearchChange(event.target.value)}
                placeholder="Search by gamertag"
                maxLength={20}
                spellCheck={false}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </label>
            {searching && <div className="social-search-status">Searching…</div>}
            {!searching && searchResults.length > 0 && (
              <div className="social-search-results">
                {searchResults.map((profile) => (
                  <div key={profile.userId} className="social-result-row">
                    <span className="social-avatar">{avatarInitial(profile.name)}</span>
                    <span className="social-result-name">{profile.name}</span>
                    <button type="button" className={`social-add-btn ${themeClass} ${isNavFocused((item) => item.kind === 'addFriend' && item.profile.userId === profile.userId) ? 'controller-focused' : ''}`} onClick={() => handleAddFriend(profile)} onMouseEnter={handleHover} disabled={busy}>
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
            {!searching && searchQuery.trim() && searchResults.length === 0 && (
              <div className="social-search-status">No players found.</div>
            )}
          </div>

          <div className="social-friend-groups">
            {friends.incoming.length > 0 && (
              <div className="social-friend-group">
                <span className="social-group-title">INCOMING REQUESTS</span>
                {friends.incoming.map((friend) => (
                  <div key={friend.userId} className="social-friend-row">
                    <span className="social-avatar social-avatar-incoming">{avatarInitial(friend.name)}</span>
                    <span className="social-friend-name">{friend.name}</span>
                    <div className="social-friend-actions">
                      <button type="button" className={`social-accept ${isNavFocused((item) => item.kind === 'acceptFriend' && item.friend.userId === friend.userId) ? 'controller-focused' : ''}`} onClick={() => handleAcceptFriend(friend)} onMouseEnter={handleHover} disabled={busy}>Accept</button>
                      <button type="button" className={`social-decline ${isNavFocused((item) => item.kind === 'declineFriend' && item.friend.userId === friend.userId) ? 'controller-focused' : ''}`} onClick={() => handleDeclineFriend(friend)} onMouseEnter={handleHover} disabled={busy}>Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {friends.outgoing.length > 0 && (
              <div className="social-friend-group">
                <span className="social-group-title">OUTGOING REQUESTS</span>
                {friends.outgoing.map((friend) => (
                  <div key={friend.userId} className="social-friend-row social-friend-row-muted">
                    <span className="social-avatar social-avatar-muted">{avatarInitial(friend.name)}</span>
                    <span className="social-friend-name">{friend.name}</span>
                    <span className="social-pending-tag">PENDING</span>
                  </div>
                ))}
              </div>
            )}

            <div className="social-friend-group">
              <span className="social-group-title">FRIENDS {totalFriends > 0 && `(${totalFriends})`}</span>
              {friends.accepted.length === 0 && (
                <div className="social-empty">No friends yet — search a gamertag above to add one.</div>
              )}
              {friends.accepted.map((friend) => (
                <div
                  key={friend.userId}
                  className="social-friend-row"
                  onContextMenu={(event) => openFriendMenu(event, friend)}
                  title="Right-click for options"
                >
                  <span className="social-avatar">{avatarInitial(friend.name)}</span>
                  {editingNick?.friendId === friend.userId ? (
                    <span className="social-nick-editor">
                      <input
                        autoFocus
                        value={editingNick.value}
                        placeholder="Nickname"
                        maxLength={24}
                        spellCheck={false}
                        onChange={(event) => setEditingNick((current) => (current ? { ...current, value: event.target.value } : current))}
                        onKeyDown={(event) => {
                          event.stopPropagation()
                          if (event.key === 'Enter') handleSaveNickname(friend)
                          if (event.key === 'Escape') setEditingNick(null)
                        }}
                      />
                      <button type="button" className="social-nick-save" onClick={() => handleSaveNickname(friend)} onMouseEnter={handleHover} disabled={busy}>
                        Save
                      </button>
                      <button type="button" className="social-nick-cancel" onClick={() => setEditingNick(null)} onMouseEnter={handleHover}>
                        ✕
                      </button>
                    </span>
                  ) : (
                    <span className="social-friend-name">{friend.name}</span>
                  )}
                  {party && isLeader && (
                    <button type="button" className={`social-invite ${isNavFocused((item) => item.kind === 'inviteFriend' && item.friend.userId === friend.userId) ? 'controller-focused' : ''}`} onClick={() => handleInviteToParty(friend)} onMouseEnter={handleHover} disabled={busy}>
                      Invite to Party
                    </button>
                  )}
                  <button
                    type="button"
                    className="social-row-menu-btn"
                    onClick={(event) => openFriendMenu(event, friend)}
                    onMouseEnter={handleHover}
                    aria-label={`Options for ${friend.name}`}
                    title="Options"
                  >
                    ⋯
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Party column ───────────────────────────────────────────── */}
        <div className={`social-panel ${themeClass}`}>
          <div className="social-panel-head">
            <span className="social-panel-kicker">PARTY</span>
            {party && <span className="social-panel-count">{party.members.length}</span>}
          </div>

          {partyInvites.length > 0 && (
            <div className="social-friend-group">
              <span className="social-group-title">PARTY INVITES</span>
              {partyInvites.map((invite) => (
                <div key={invite.id} className="social-friend-row">
                  <span className="social-avatar social-avatar-incoming">{avatarInitial(invite.inviterName)}</span>
                  <span className="social-friend-name">{invite.inviterName} invited you</span>
                  <div className="social-friend-actions">
                    <button type="button" className={`social-accept ${isNavFocused((item) => item.kind === 'acceptInvite' && item.invite.id === invite.id) ? 'controller-focused' : ''}`} onClick={() => handleAcceptPartyInvite(invite)} onMouseEnter={handleHover} disabled={busy}>Accept</button>
                    <button type="button" className={`social-decline ${isNavFocused((item) => item.kind === 'declineInvite' && item.invite.id === invite.id) ? 'controller-focused' : ''}`} onClick={() => handleDeclinePartyInvite(invite)} onMouseEnter={handleHover} disabled={busy}>Decline</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {party ? (
            <div className="social-party-card">
              <div className="social-party-head">
                <div className="social-party-title">
                  {isLeader && <span className="social-party-crown">★</span>}
                  <span className="social-party-leader-name">{party.leaderName}</span>
                </div>
                <span className="social-party-role">{isLeader ? 'LEADER' : 'MEMBER'}</span>
              </div>

              <div className="social-party-code-row">
                <span className="social-party-code-label">INVITE CODE</span>
                <div className="social-party-code-chip">
                  <code>{party.inviteCode || '—'}</code>
                  <button
                    type="button"
                    className={`social-party-copy ${themeClass} ${isNavFocused((item) => item.kind === 'copyCode') ? 'controller-focused' : ''}`}
                    onClick={handleCopyPartyCode}
                    onMouseEnter={handleHover}
                    disabled={!party.inviteCode}
                  >
                    {codeCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div className="social-party-members">
                {party.members.map((member) => (
                  <div key={member.userId} className={`social-party-member ${member.userId === party.leaderUserId ? 'leader' : ''}`}>
                    <span className={`social-avatar ${member.userId === party.leaderUserId ? 'social-avatar-leader' : ''}`}>{avatarInitial(member.name)}</span>
                    {member.userId === party.leaderUserId && <span className="social-party-crown">★</span>}
                    <span className="social-party-member-name">{member.name}</span>
                    {member.userId === myId && <span className="social-party-you">YOU</span>}
                  </div>
                ))}
              </div>

              {party.leaderServerId && (
                <div className="social-party-status">Leader is in a lobby — your client follows automatically.</div>
              )}

              <button type="button" className={`social-party-leave ${isNavFocused((item) => item.kind === 'leaveParty') ? 'controller-focused' : ''}`} onClick={handleLeaveParty} onMouseEnter={handleHover} disabled={busy}>
                {isLeader ? 'Disband Party' : 'Leave Party'}
              </button>
            </div>
          ) : (
            <div className="social-party-join">
              <button type="button" className={`social-party-create ${themeClass} ${isNavFocused((item) => item.kind === 'createParty') ? 'controller-focused' : ''}`} onClick={handleCreateParty} onMouseEnter={handleHover} disabled={busy}>
                Create Party
              </button>
              <div className="social-party-or"><span>OR</span></div>
              <label className="social-party-code-field">
                <span>Join Party with Code</span>
                <input
                  className={`social-party-code-input ${isNavFocused((item) => item.kind === 'partyCode') ? 'controller-focused' : ''}`}
                  value={partyCode}
                  onChange={(event) => setPartyCode(event.target.value.toUpperCase())}
                  placeholder="Enter 6-character code"
                  maxLength={6}
                  spellCheck={false}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.key === 'Enter') handleJoinPartyByCode()
                  }}
                />
              </label>
              <button type="button" className={`social-party-joinbtn ${themeClass} ${isNavFocused((item) => item.kind === 'joinParty') ? 'controller-focused' : ''}`} onClick={handleJoinPartyByCode} onMouseEnter={handleHover} disabled={busy || !partyCode.trim()}>
                Join Party
              </button>
            </div>
          )}

          <p className="social-party-hint">
            When the party leader joins a lobby, every member's client automatically joins it too.
          </p>
        </div>
      </div>

      {/* Friend context menu — portaled to <body> so its fixed positioning
          stays viewport-relative regardless of panel overflow/stacking. */}
      {friendMenu && createPortal(
        <div
          ref={menuRef}
          className={`social-context-menu ${themeClass}`}
          style={{ left: friendMenu.x, top: friendMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="social-context-header">
            <span className="social-avatar">{avatarInitial(friendMenu.friend.name)}</span>
            <span className="social-context-name">{friendMenu.friend.name}</span>
          </div>
          {menuConfirm ? (
            <>
              <div className="social-context-confirm">
                Remove {friendMenu.friend.name} from your friends?
              </div>
              <button type="button" className="social-context-item social-context-danger" onClick={() => handleRemoveFriend(friendMenu.friend)} onMouseEnter={handleHover} disabled={busy}>
                Remove Friend
              </button>
              <button type="button" className="social-context-item" onClick={closeFriendMenu} onMouseEnter={handleHover}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="social-context-item"
                onClick={() => handleInviteToParty(friendMenu.friend)}
                onMouseEnter={handleHover}
                disabled={!party || !isLeader}
                title={!party ? 'Create or join a party first' : 'Only the party leader can invite'}
              >
                Invite to Party
              </button>
              {(!party || !isLeader) && (
                <div className="social-context-hint">
                  {!party ? 'Create or join a party to invite.' : 'Only the party leader can invite.'}
                </div>
              )}
              <button type="button" className="social-context-item" onClick={() => startEditingNickname(friendMenu.friend)} onMouseEnter={handleHover}>
                {nicknames[friendMenu.friend.userId] ? 'Edit Nickname' : 'Set Nickname'}
              </button>
              {nicknames[friendMenu.friend.userId] && (
                <button type="button" className="social-context-item" onClick={() => handleClearNickname(friendMenu.friend)} onMouseEnter={handleHover}>
                  Clear Nickname
                </button>
              )}
              <button
                type="button"
                className="social-context-item social-context-danger"
                onClick={() => {
                  handleSelect()
                  setMenuConfirm(true)
                }}
                onMouseEnter={handleHover}
              >
                Remove Friend…
              </button>
            </>
          )}
        </div>,
        document.getElementById('ui-portal-root') || document.body
      )}
    </div>
  )
}
