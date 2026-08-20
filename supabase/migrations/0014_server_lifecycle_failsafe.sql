-- =====================================================================
-- Legacy Warzone Launcher — server lifecycle failsafe (0014)
-- =====================================================================
--
-- A host renews `last_heartbeat_at` every 15 seconds while its launcher is
-- alive. A lobby whose lease is older than 45 seconds is no longer valid.
-- The launcher also filters expired rows immediately, while this database
-- job removes them for every user even when the host process was force-killed
-- and no new launcher process starts.
--
-- Apply this file in Supabase Dashboard → SQL Editor. Supabase Cron is the
-- pg_cron extension; the migration enables it and creates the recurring job.
-- The job is replaced by name when this migration is re-run, so it is safe
-- to apply more than once.

-- ---------------------------------------------------------------------
-- 1) Add a lease timestamp to every server row
-- ---------------------------------------------------------------------
alter table public.servers
  add column if not exists last_heartbeat_at timestamp with time zone;

-- Existing rows are treated as having been seen at migration time. They will
-- expire normally if their host does not run the updated launcher afterward.
update public.servers
  set last_heartbeat_at = coalesce(last_heartbeat_at, now());

alter table public.servers
  alter column last_heartbeat_at set default now();

alter table public.servers
  alter column last_heartbeat_at set not null;

create index if not exists servers_heartbeat_idx
  on public.servers(last_heartbeat_at);

-- ---------------------------------------------------------------------
-- 2) Privileged cleanup function
-- ---------------------------------------------------------------------
create or replace function public.prune_stale_servers()
returns bigint
language plpgsql
security definer
set search_path = public
as $function$
declare
  deleted_count bigint;
begin
  delete from public.servers
    where last_heartbeat_at < now() - interval '45 seconds';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;

-- The app never calls this function directly. It is only run by the
-- database scheduler, not by arbitrary client sessions.
revoke all on function public.prune_stale_servers() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) Run cleanup every minute through Supabase Cron
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;

do $do$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
    from cron.job
   where jobname = 'legacy-warzone-prune-stale-servers';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'legacy-warzone-prune-stale-servers',
    '* * * * *',
    $job$select public.prune_stale_servers();$job$
  );
end
$do$;
