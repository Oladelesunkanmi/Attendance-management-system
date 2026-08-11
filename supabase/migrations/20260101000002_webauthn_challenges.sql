-- WebAuthn challenge storage for registration/authentication flows

create table webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  challenge text not null,
  challenge_type text not null check (challenge_type in ('registration', 'authentication')),
  created_at timestamptz default now(),
  expires_at timestamptz not null
);

create index webauthn_challenges_user_id_idx on webauthn_challenges(user_id);

alter table webauthn_challenges enable row level security;

create policy "No direct client access to webauthn challenges"
  on webauthn_challenges for all
  to authenticated
  using (false);
