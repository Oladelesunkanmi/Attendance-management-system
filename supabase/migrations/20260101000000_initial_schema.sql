-- Attendance System: initial schema (§3 + refinements)

-- Profiles extend auth.users
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  matric_number text unique,
  full_name text not null,
  role text not null check (role in ('student', 'lecturer')),
  created_at timestamptz default now()
);

create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_meters int not null default 25,
  created_at timestamptz default now()
);

create table courses (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  title text not null,
  lecturer_id uuid references profiles(id)
);

create table enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade,
  student_id uuid references profiles(id) on delete cascade,
  unique (course_id, student_id)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) on delete cascade,
  venue_id uuid references venues(id),
  started_at timestamptz default now(),
  ended_at timestamptz,
  is_active boolean default true,
  verification_mode text not null default 'full'
    check (verification_mode in ('qr_only', 'qr_geofence', 'full'))
);

create table webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references profiles(id) on delete cascade,
  credential_id text unique not null,
  public_key bytea not null,
  counter bigint not null default 0,
  aaguid text,
  device_attestation_id text,
  enrolled_by uuid references profiles(id),
  enrolled_at timestamptz default now()
);

create table qr_token_nonces (
  jti uuid primary key,
  session_id uuid references sessions(id) on delete cascade,
  issued_at timestamptz default now(),
  consumed_at timestamptz,
  consumed_by uuid references profiles(id)
);

create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  student_id uuid references profiles(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  distance_meters double precision not null,
  gps_accuracy_meters double precision,
  webauthn_verified boolean not null default false,
  flagged_reason text,
  checked_in_at timestamptz default now(),
  unique (session_id, student_id)
);

create table device_reuse_flags (
  id uuid primary key default gen_random_uuid(),
  device_attestation_id text not null,
  student_a uuid references profiles(id),
  student_b uuid references profiles(id),
  reviewed boolean default false,
  detected_at timestamptz default now()
);

create table rate_limit_buckets (
  key text primary key,
  count int not null default 0,
  window_start timestamptz not null default now()
);

create table profile_creation_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  error_message text not null,
  created_at timestamptz default now()
);

-- Indexes for dashboard and lookups
create index attendance_records_session_id_idx on attendance_records(session_id);
create index sessions_course_active_idx on sessions(course_id) where is_active;
create index qr_token_nonces_session_id_idx on qr_token_nonces(session_id);
create index enrollments_student_id_idx on enrollments(student_id);
create index enrollments_course_id_idx on enrollments(course_id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, matric_number)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'student'),
    nullif(trim(new.raw_user_meta_data->>'matric_number'), '')
  );
  return new;
exception when others then
  insert into public.profile_creation_errors (user_id, error_message)
  values (new.id, sqlerrm);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
