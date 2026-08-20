-- =====================================================================
-- Legacy Warzone Launcher — servers table privileges (0006)
-- =====================================================================
--
-- RLS policies decide which rows a role may access, but PostgreSQL table
-- privileges must also allow the operation in the first place. This repair
-- is for projects where `public.servers` exists and its policies exist, but
-- the API roles receive "permission denied for table servers".

-- Public and authenticated clients may browse rows allowed by RLS.
grant select on table public.servers to anon, authenticated;

-- Only authenticated clients may attempt mutations. Existing RLS policies
-- restrict mutations to the signed-in host (auth.uid() = host_user_id).
grant insert, update, delete on table public.servers to authenticated;

-- `id` is normally a bigserial/identity column. PostgREST inserts use the
-- column default, which obtains the next value from its sequence. Resolve
-- the sequence from the catalog so this remains safe if its name differs or
-- the project uses an identity column.
do $$
declare
  servers_id_sequence text := pg_get_serial_sequence('public.servers', 'id');
begin
  if servers_id_sequence is not null then
    execute format(
      'grant usage, select on sequence %s to authenticated',
      servers_id_sequence::regclass
    );
  end if;
end $$;

notify pgrst, 'reload schema';
