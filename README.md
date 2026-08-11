# QR + Geofence + WebAuthn Attendance System

React PWA frontend with Supabase Postgres, Auth, Row Level Security, and Edge Functions.

## Stack

- **Frontend:** React (Vite) + Tailwind CSS + PWA
- **Backend:** Supabase Edge Functions (Deno/TypeScript)
- **Database:** Supabase Postgres with RLS
- **Hosting:** Vercel (frontend) + Supabase (backend/DB)

## Project structure

```
attendance-system/
├── src/                         # React PWA
├── supabase/
│   ├── migrations/              # SQL schema + RLS
│   └── functions/               # Edge Functions
│       ├── issue-qr-token/
│       ├── verify-checkin/
│       ├── webauthn-register/
│       └── webauthn-authenticate/
```

## 1. Create Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free project.
2. Copy your **Project URL** and **anon key** from Settings → API.

## 2. Run database migrations

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Or paste the SQL files manually in the Supabase SQL editor (in order):

1. `supabase/migrations/20260101000000_initial_schema.sql`
2. `supabase/migrations/20260101000001_rls_policies.sql`
3. `supabase/migrations/20260101000002_webauthn_challenges.sql`

## 3. Configure Edge Function secrets

In Supabase → Edge Functions → Secrets, set:

| Secret | Example |
|---|---|
| `SUPABASE_URL` | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | your anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key (never expose to frontend) |
| `QR_JWT_SECRET` | long random string |
| `WEBAUTHN_RP_ID` | `your-app.vercel.app` (no protocol) |
| `WEBAUTHN_ORIGIN` | `https://your-app.vercel.app` |
| `WEBAUTHN_RP_NAME` | `Attendance System` |

Deploy functions:

```bash
supabase functions deploy issue-qr-token
supabase functions deploy verify-checkin
supabase functions deploy webauthn-register
supabase functions deploy webauthn-authenticate
```

## 4. Frontend setup

```bash
cp .env.example .env
# Edit .env with your Supabase URL and anon key

npm install
npm run dev
```

Open `http://localhost:5173`.

## 5. Deploy to Vercel (required for phone WebAuthn testing)

1. Push this repo to GitHub.
2. Import into [Vercel](https://vercel.com).
3. Set environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
4. Update Supabase Auth → URL Configuration:
   - Site URL: your Vercel URL
   - Redirect URLs: your Vercel URL + `http://localhost:5173`
5. Update Edge Function secrets `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` to match Vercel.

## Usage flow

### Lecturer

1. Sign up as **lecturer**.
2. Create **courses** and **venues** (use “Use current GPS” at the lecture room).
3. Start a **session** (choose verification mode: `qr_only`, `qr_geofence`, or `full`).
4. Display the rotating QR; watch the live check-in feed.
5. Export CSV for evaluation.

### Student

1. Sign up as **student** (with matric number).
2. **Enrol biometrics** once (supervised — lecturer verifies ID card).
3. At each session: **Check in** → scan QR → allow GPS → biometric prompt (when mode is `full`).

## Verification modes (evaluation)

Each session has a `verification_mode`:

| Mode | Checks |
|---|---|
| `qr_only` | Valid QR token only |
| `qr_geofence` | QR + GPS geofence |
| `full` | QR + geofence + WebAuthn |

## Security notes

- Attendance writes go through `verify-checkin` Edge Function only (service role).
- QR tokens expire in 30 seconds and use one-time nonces (`jti`).
- WebAuthn requires HTTPS — use Vercel for real phone testing.
- Never commit `.env` or service role keys.

## Build order completed in this scaffold

- [x] Schema + RLS migrations
- [x] Auth (login/signup with role metadata)
- [x] Lecturer: courses, venues, sessions, live feed, CSV export
- [x] Edge Functions: QR issue, verify-checkin, WebAuthn register/authenticate
- [x] Student: biometric enrolment, QR scan + check-in
- [ ] Offline sync queue (lecturer dashboard) — next step
- [ ] Device reuse review screen — next step

## Local development tips

- Test WebAuthn on your **phone** against the **deployed Vercel URL**, not just localhost.
- Start with `full` mode on one test session after enrolment works.
- Use Supabase Table Editor to inspect `attendance_records.flagged_reason` during evaluation.
