-- Row Level Security policies (§4)

alter table profiles enable row level security;
alter table venues enable row level security;
alter table courses enable row level security;
alter table enrollments enable row level security;
alter table sessions enable row level security;
alter table webauthn_credentials enable row level security;
alter table qr_token_nonces enable row level security;
alter table attendance_records enable row level security;
alter table device_reuse_flags enable row level security;
alter table rate_limit_buckets enable row level security;

-- Helper: is the current user a lecturer?
create or replace function public.is_lecturer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'lecturer'
  );
$$;

-- Helper: is the current user the lecturer for a course?
create or replace function public.is_course_lecturer(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from courses
    where id = p_course_id and lecturer_id = auth.uid()
  );
$$;

-- Helper: is the current user enrolled in a course?
create or replace function public.is_enrolled_in_course(p_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from enrollments
    where course_id = p_course_id and student_id = auth.uid()
  );
$$;

-- profiles
create policy "Users can read own profile"
  on profiles for select
  using (id = auth.uid());

create policy "Users can update own profile"
  on profiles for update
  using (id = auth.uid());

create policy "Lecturers can read profiles in their courses"
  on profiles for select
  using (
    public.is_lecturer() and (
      id = auth.uid()
      or exists (
        select 1 from enrollments e
        join courses c on c.id = e.course_id
        where e.student_id = profiles.id and c.lecturer_id = auth.uid()
      )
    )
  );

-- venues (lecturers manage; students read for active sessions)
create policy "Authenticated users can read venues"
  on venues for select
  to authenticated
  using (true);

create policy "Lecturers can insert venues"
  on venues for insert
  to authenticated
  with check (public.is_lecturer());

create policy "Lecturers can update venues"
  on venues for update
  to authenticated
  using (public.is_lecturer());

-- courses
create policy "Lecturers can manage own courses"
  on courses for all
  to authenticated
  using (lecturer_id = auth.uid())
  with check (lecturer_id = auth.uid());

create policy "Students can read enrolled courses"
  on courses for select
  to authenticated
  using (public.is_enrolled_in_course(id));

-- enrollments
create policy "Lecturers can manage enrollments for own courses"
  on enrollments for all
  to authenticated
  using (public.is_course_lecturer(course_id))
  with check (public.is_course_lecturer(course_id));

create policy "Students can read own enrollments"
  on enrollments for select
  to authenticated
  using (student_id = auth.uid());

-- sessions
create policy "Lecturers can manage sessions for own courses"
  on sessions for all
  to authenticated
  using (public.is_course_lecturer(course_id))
  with check (public.is_course_lecturer(course_id));

create policy "Students can read sessions for enrolled courses"
  on sessions for select
  to authenticated
  using (public.is_enrolled_in_course(course_id));

-- webauthn_credentials: no direct client access
create policy "No direct client access to webauthn credentials"
  on webauthn_credentials for all
  to authenticated
  using (false);

-- qr_token_nonces: Edge Functions only (service role bypasses RLS)
create policy "No direct client access to qr token nonces"
  on qr_token_nonces for all
  to authenticated
  using (false);

-- attendance_records: no direct insert from client; select own or lecturer's session
create policy "Students can read own attendance"
  on attendance_records for select
  to authenticated
  using (student_id = auth.uid());

create policy "Lecturers can read attendance for own course sessions"
  on attendance_records for select
  to authenticated
  using (
    exists (
      select 1 from sessions s
      join courses c on c.id = s.course_id
      where s.id = attendance_records.session_id
        and c.lecturer_id = auth.uid()
    )
  );

-- device_reuse_flags: lecturers only
create policy "Lecturers can read device reuse flags"
  on device_reuse_flags for select
  to authenticated
  using (public.is_lecturer());

create policy "Lecturers can update device reuse flags"
  on device_reuse_flags for update
  to authenticated
  using (public.is_lecturer());

-- rate_limit_buckets: Edge Functions only
create policy "No direct client access to rate limits"
  on rate_limit_buckets for all
  to authenticated
  using (false);

-- Enable Realtime for lecturer dashboard
alter publication supabase_realtime add table attendance_records;
