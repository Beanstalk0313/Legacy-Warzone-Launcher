// Derives the best display name for a signed-in Supabase user.
//
// Single source of truth for the fallback chain used everywhere a
// username is shown (Account tab, header user chip, future friend
// roster): gamertag → username → full_name → name → email prefix →
// generic fallback. Kept here so the Account tab and the two interface
// headers can't drift apart.
export function getDisplayName(user) {
  const metadata = user?.user_metadata || {}
  const email = user?.email || ''
  return (
    metadata.gamertag ||
    metadata.username ||
    metadata.full_name ||
    metadata.name ||
    email.split('@')[0] ||
    'Signed-in user'
  )
}
