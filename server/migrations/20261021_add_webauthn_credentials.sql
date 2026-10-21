CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports jsonb,
  enrolled_at timestamptz DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS webauthn_credentials_student_id_idx ON public.webauthn_credentials(student_id);
