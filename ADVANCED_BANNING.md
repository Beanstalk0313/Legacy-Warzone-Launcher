# Advanced banning

The open-beta launcher stores the currently signed-in account identity in a
**device identity file** — the exact file name and location are intentionally
not published here (they are baked into the binary at build time from
environment variables; see the README's "Device identity file" section). The
build fails if those variables are unset, so a released binary never carries
a guessable default location, and the values are never committed.

The file contains the current account's Discord username, gamertag, and email.
It is refreshed after sign-up and sign-in and deliberately retained across
sign-out — the local identity is the DEVICE identity behind the ban system, so
signing out must not erase it (otherwise anyone could clear a device ban by
signing out, then signing up fresh).

## Apply the Supabase migrations

1. Open the [Supabase Dashboard](https://supabase.com/dashboard).
2. Select the launcher project.
3. Open **SQL Editor** in the left sidebar.
4. Create a new query.
5. Paste the complete contents of `supabase/migrations/0013_advanced_banning.sql`.
6. Click **Run**.
7. Then run `supabase/migrations/0015_ban_check_anon_grant.sql` the same way — it is
   required for the pre-sign-in check to work (see below).
8. Finally run `supabase/migrations/0016_ban_check_gamertag_match.sql` — it makes the
   device check also match by gamertag (see "Matching behavior").

Run the earlier migrations first if this project has not already applied them. In
particular, 0013 expects the `public.profiles` table from 0001 and the latest
`handle_new_user()` trigger changes from 0008 onward.

## Ban or unban an account from the dashboard

1. Open **Table Editor** in the left sidebar.
2. Select the `public.profiles` table.
3. Locate the account by its `user_id` or `discord_username`.
4. Set `is_banned` to `true` to ban it, then save the row.
5. Set `is_banned` back to `false` to unban it.

The `is_banned` column defaults to `false`. Do not change the `user_id` value.
The admin dashboard can edit this field even though normal launcher clients are
restricted by Row Level Security.

## Matching behavior

At desktop startup, before the launcher is rendered, the app calls the protected
`check_identity_ban()` Supabase function against the identity in the device
identity file. It refuses to load the launcher if:

- the identity in the file is itself banned;
- any banned account has the same Discord username as the file's identity;
- any banned account has the same email as the file's identity; or
- any banned account has the same gamertag (its `profiles.username`) as the
  file's gamertag — added in 0016 so a banned profile with a
  missing/mismatched Discord or email still blocks the device.

### The device check runs BEFORE sign-in

When the identity file exists, it is verified against the ban records **before the
sign-in screen is ever shown** — a signed-in session is not required for the
check to run. This closes the wipe-and-resign bypass: wiping the app's session
storage doesn't reset the ban, because a banned device is blocked no matter
which account would be signed in next. The identity file can only be
overwritten by a sign-in AFTER this pre-check has passed, so the banned
identity can't be swapped out to dodge the block. Sign-out does NOT delete the
file (see above), so signing out can't reset a banned device either. A missing
identity file still shows the account setup screen so a new tester can sign up
or sign in before the first check.

Because the pre-sign-in check runs with **no authenticated session**, the RPC
must be executable by the `anon` role — that is what migration 0015 grants.
Without it, the check fails with "permission denied" and the launcher shows
SECURITY CHECK UNAVAILABLE for everyone (not just banned devices). The anon
key ships in every launcher bundle anyway, and the function returns only a
boolean, so this does not meaningfully weaken the ban system.

Discord usernames, email addresses, and gamertags are compared
case-insensitively after trimming. The gamertag match (0016) compares the
identity file's gamertag to `profiles.username` — the value `handle_new_user`
stores from the sign-up gamertag. Tradeoff: gamertags are not guaranteed
unique across accounts, so a device whose identity file shares a gamertag with
a banned profile on a DIFFERENT account is blocked too (a false positive). The
ban system previously excluded gamertags for this reason, but the
"block the PC, not just the account" requirement makes the stricter match the
default. Revert by re-running 0013's function body.

If a ban is ever set on an account but the launcher still lets the device
through, the first thing to check is whether `is_banned` is actually `true`
on that account's `profiles` row IN THE SAME SUPABASE PROJECT the launcher
is configured with (the `VITE_SUPABASE_URL` in `.env`) — the RPC can only
match rows that are flagged there.

If Supabase cannot complete the check (or is not configured), the launcher
fails closed and shows the security-blocked screen.

The local file is an identity cache, not a tamper-proof credential store. A
local administrator can modify any file on the machine; the actual ban decision
still comes from the Supabase RPC and is never trusted from the identity file
alone. Deleting the identity file itself resets the device identity to "new
tester" — the file is deliberately stored outside the app's data directory,
but a determined local admin can always remove it.
