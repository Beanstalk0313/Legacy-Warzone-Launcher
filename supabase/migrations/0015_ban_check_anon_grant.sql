-- =====================================================================
-- Legacy Warzone Launcher — pre-sign-in ban check (0015)
-- =====================================================================
--
-- The desktop launcher checks the local device identity file against
-- the ban records BEFORE showing the sign-in screen (see the README's
-- "Advanced banning" section).
-- That check runs without an authenticated session, so
-- `check_identity_ban()` must be callable by the `anon` role — otherwise
-- every pre-sign-in check fails with "permission denied for function
-- check_identity_ban" and the launcher shows the SECURITY CHECK UNAVAILABLE
-- screen for everyone (the exact symptom of the wiped-AppData state the
-- pre-sign-in check exists to catch).
--
-- 0013 deliberately kept the function authenticated-only to discourage
-- anonymous probing of identity combinations. That gate no longer applies:
-- the anon key ships inside every launcher bundle (it is not a secret), the
-- function only ever returns a boolean, and the pre-sign-in device check is
-- the whole point of the ban system (block the PC, not just the account).

grant execute on function public.check_identity_ban(text, text, text) to anon;

notify pgrst, 'reload schema';
