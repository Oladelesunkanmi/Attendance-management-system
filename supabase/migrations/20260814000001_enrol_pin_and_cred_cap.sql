-- ============================================================
-- Migration: enrolment PIN system + credential cap
-- Apply after: 20260101000000_initial_schema.sql
-- ============================================================

-- ── Before applying, check for existing duplicate active credentials ──────────
-- Run this query manually first and resolve any rows it returns:
--
--   SELECT student_id, COUNT(*) as cred_count, array_agg(id) as cred_ids
--   FROM webauthn_credentials
--   GROUP BY student_id
--   HAVING COUNT(*) > 1;
--
-- If duplicates exist, keep only the most recent and revoke the rest:
--
--   UPDATE webauthn_credentials
--   SET revoked_at = now()
--   WHERE id NOT IN (
--     SELECT DISTINCT ON (student_id) id
--     FROM webauthn_credentials
--     ORDER BY student_id, enrolled_at DESC
--   );
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add revocation columns to webauthn_credentials
alter table webauthn_credentials
  add column if not exists revoked_at  timestamptz,
  add column if not exists revoked_by  uuid references profiles(id);

-- 2. Partial unique index: only one ACTIVE credential allowed per student.
--    Revoked rows are outside this index and do not block re-enrolment.
create unique index if not exists one_active_credential_per_student
  on webauthn_credentials (student_id)
  where revoked_at is null;

-- 3. Enrolment PIN table — lecturer generates a short-lived PIN for each
--    supervised enrolment event. Student submits it; server resolves the
--    lecturer_id from it rather than trusting client-supplied UUIDs.
create table if not exists enrolment_pins (
  id          uuid        primary key default gen_random_uuid(),
  pin         text        not null,
  lecturer_id uuid        not null references profiles(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,           -- set on first (and only) use
  created_at  timestamptz not null default now()
);

-- Index for fast PIN lookups at enrolment time
create index if not exists enrolment_pins_pin_idx
  on enrolment_pins (pin)
  where used_at is null;

-- Auto-expire: clean up PINs older than 1 hour to keep the table small.
-- This is a best-effort housekeeping query you can run periodically, e.g.:
--   DELETE FROM enrolment_pins WHERE expires_at < now() - interval '1 hour';
