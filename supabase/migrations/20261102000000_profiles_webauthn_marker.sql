-- ============================================================
-- Migration: profile-level WebAuthn marker
-- Apply after: 20261021000000_add_webauthn_credentials.sql
-- ============================================================
--
-- The server has been reading and writing profiles.webauthn_credential_id
-- since the Express webauthn-register route was introduced, but no migration
-- ever created the column. This adds it and backfills every student who
-- enrolled before it existed.
--
-- The column is a convenience copy: webauthn_credentials remains the source
-- of truth for "is this student enrolled?", and the enrolment-status endpoint
-- reads the credential row rather than this marker. Step 4 installs a trigger
-- so the copy cannot drift when a new enrolment path is added later.

-- 1. Add the column. It holds the WebAuthn credential id (a base64url
--    string), not the credential row's uuid, so the type is text.
alter table profiles
  add column if not exists webauthn_credential_id text;

-- 2. Backfill, newest active credential per student.
update profiles p
set webauthn_credential_id = c.credential_id
from (
  select distinct on (student_id)
    student_id,
    credential_id
  from webauthn_credentials
  where revoked_at is null
  order by student_id, enrolled_at desc
) c
where c.student_id = p.id
  and p.webauthn_credential_id is null;

-- 3. Students with no active credential should carry no marker.
update profiles p
set webauthn_credential_id = null
where p.webauthn_credential_id is not null
  and not exists (
    select 1
    from webauthn_credentials c
    where c.student_id = p.id
      and c.revoked_at is null
  );

-- 4. Keep the marker in step from now on, whatever writes the credential row.
--    The Express route and the webauthn-register edge function both write the
--    marker themselves, but a third enrolment path would otherwise be free to
--    forget it. This trigger is the invariant behind them: after any change to
--    a student's credentials, the marker is recomputed from the newest active
--    row (or cleared when there is none).
create or replace function public.sync_profile_webauthn_marker()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_students uuid[];
begin
  -- A delete has no NEW, and an update can move a credential between students.
  if tg_op = 'DELETE' then
    v_students := array[old.student_id];
  elsif tg_op = 'UPDATE' then
    v_students := array[new.student_id, old.student_id];
  else
    v_students := array[new.student_id];
  end if;

  with target as (
    select p.id,
           (
             select c.credential_id
             from webauthn_credentials c
             where c.student_id = p.id
               and c.revoked_at is null
             order by c.enrolled_at desc
             limit 1
           ) as active_credential_id
    from profiles p
    where p.id = any(v_students)
  )
  update profiles p
  set webauthn_credential_id = t.active_credential_id
  from target t
  where p.id = t.id
    and p.webauthn_credential_id is distinct from t.active_credential_id;

  return null;
end;
$$;

drop trigger if exists webauthn_credentials_marker_insert on webauthn_credentials;
drop trigger if exists webauthn_credentials_marker_update on webauthn_credentials;
drop trigger if exists webauthn_credentials_marker_delete on webauthn_credentials;

create trigger webauthn_credentials_marker_insert
after insert on webauthn_credentials
for each row execute function public.sync_profile_webauthn_marker();

-- Check-in bumps `counter` on every scan, so the update trigger is restricted
-- to the columns that can actually change the answer. Without this, every
-- attendance check would pay for a marker recompute.
create trigger webauthn_credentials_marker_update
after update on webauthn_credentials
for each row
when (
  old.revoked_at is distinct from new.revoked_at
  or old.student_id is distinct from new.student_id
  or old.credential_id is distinct from new.credential_id
  or old.enrolled_at is distinct from new.enrolled_at
)
execute function public.sync_profile_webauthn_marker();

create trigger webauthn_credentials_marker_delete
after delete on webauthn_credentials
for each row execute function public.sync_profile_webauthn_marker();
