# QR + Geofence + WebAuthn Attendance System

A modern, multi-factor attendance verification system built for university classrooms. It combines rotating QR codes, GPS geofencing, and WebAuthn biometric authentication to drastically reduce proxy attendance fraud ("buddy check-in") while preserving usability.

---

## 🚀 Tech Stack

- **Frontend**: React 19 (Vite) + Tailwind CSS + PWA (Custom Service Worker + IndexedDB)
- **Backend API**: Node.js Express Server (TypeScript)
- **Database**: Supabase (PostgreSQL)
- **Key Libraries**: `@simplewebauthn` for Passkeys, `jose` for secure JWTs, `html5-qrcode` & `qrcode` for QR handling.

---

## 📁 Project Structure

```
attendance-system/
├── src/                      # Frontend React PWA
│   ├── components/           # UI components and layout wrappers
│   ├── pages/                # Screen views (Lecturer and Student Dashboards)
│   ├── lib/                  # Utilities (Supabase client, IDB queue logic)
│   └── sw.ts                 # Service Worker for Offline Sync
├── server/                   # Backend Node.js Express API
│   ├── src/routes/           # API endpoints (Auth, WebAuthn, Verification)
│   └── src/lib/              # Backend logic (Haversine geofencing, rate limits)
├── supabase/                 # Supabase configuration
│   └── migrations/           # Database schema migrations
└── public/                   # Static assets
```

---

## 🔐 Core Verification Layers

The system uses a layered approach to verify a student's presence:

1. **Rotating QR Tokens**: The lecturer's screen displays a QR code that rotates every 25 seconds. The underlying JWT token has a strict 3-minute TTL (Time-To-Live) and is consumed exactly once via a database nonce to prevent screenshot replays.
2. **GPS Geofencing**: The student's device coordinates are checked against the classroom's registered coordinates using the Haversine formula. The acceptable radius is configurable per venue.
3. **WebAuthn Biometrics**: Passkeys tie a student's account to a physical device. Supervisor PINs are used to authorize the initial device enrolment.

### Verification Modes

Lecturers can set the strictness of each session based on the venue's reliability:

| Mode | Verification Checks |
|---|---|
| `qr_only` | Rotating QR Token only |
| `qr_geofence` | QR Token + GPS Geofence Check |
| `full` | QR Token + GPS Geofence + WebAuthn Biometric Verification |

---

## 📶 Offline Resilience (PWA)

Network connectivity in large lecture halls can be unreliable. The frontend operates as a Progressive Web App (PWA):
- Check-ins attempted while offline are queued locally using **IndexedDB**.
- A custom **Service Worker** uses the Background Sync API to automatically replay queued check-ins when the connection is restored.
- *Note*: Because QR tokens have a strict 3-minute expiry, check-ins that remain offline beyond this window are deliberately discarded to prevent stale token abuse.

---

## ☁️ Supabase Setup and Deployment

This project uses Supabase for both PostgreSQL and user authentication. The React app connects with the public/anon key and relies on Row Level Security (RLS); the Express API uses a service-role key for trusted server-side operations. Deploy the database, API, and frontend as separate parts of the application.

### 1. Create a Supabase project

1. Create a project in the [Supabase Dashboard](https://supabase.com/dashboard) and save its database password somewhere secure.
2. In **Project Settings → API** (or **API Keys**, depending on the dashboard version), copy:
   - The project URL, such as `https://<project-ref>.supabase.co`.
   - The **anon/public** key for the browser and user-scoped API client.
   - The **service_role** key for the Express API only. It bypasses RLS and must never be put in a `VITE_` variable or shipped to the browser.
3. The project reference is the `<project-ref>` part of the URL. You may need it when linking the Supabase CLI.

Do not use a production database that already contains data for the first schema run unless you have checked each SQL statement and made a backup. The initial migration creates tables and a signup trigger; it is intended for a new database.

### 2. Apply the database migrations

All database migrations are now in the standard Supabase CLI directory, `supabase/migrations/`. The repository includes `supabase/config.toml`, so you can link the CLI to a new Supabase project and apply the migrations from one path.

For a **new, empty Supabase project**, install the [Supabase CLI](https://supabase.com/docs/guides/cli), open PowerShell at the repository root, and run:

```powershell
supabase login
supabase link --project-ref <project-ref>
supabase migration list --linked
supabase db push --dry-run
supabase db push
```

Replace `<project-ref>` with the project reference from the Supabase URL. `supabase db push --dry-run` previews the SQL files that will be applied without changing the database. Review that list; then run `supabase db push` to apply them. The first migration creates the core schema and signup trigger, so only run this sequence against an empty/new database.

The migrations are applied in timestamp order:

| Order | SQL file | What it installs |
|---|---|---|
| 1 | `supabase/migrations/20260101000000_initial_schema.sql` | Core tables, indexes, and automatic profile creation on signup |
| 2 | `supabase/migrations/20260101000001_rls_policies.sql` | RLS, access policies, helper functions, and attendance Realtime |
| 3 | `supabase/migrations/20260101000002_webauthn_challenges.sql` | WebAuthn challenge storage |
| 4 | `supabase/migrations/20260814000001_enrol_pin_and_cred_cap.sql` | Enrolment PINs and active credential limits |
| 5 | `supabase/migrations/20260821000001_add_min_attendance_pct.sql` | Course attendance threshold |
| 6 | `supabase/migrations/20261021000000_add_webauthn_credentials.sql` | WebAuthn credential compatibility additions |
| 7 | `supabase/migrations/20261102000000_profiles_webauthn_marker.sql` | `profiles.webauthn_credential_id` marker, backfilled for students who enrolled before the column existed, plus a trigger that keeps it in sync with `webauthn_credentials` |

If you already ran any of these SQL files manually in the Supabase Dashboard, **do not immediately run `supabase db push`**. The CLI tracks applied migrations separately from the database schema; reconcile the remote migration history with the SQL already applied first, or the CLI may attempt to create existing objects again. Back up existing data and verify the linked project and pending migration list before applying changes. Never delete or recreate tables to clear a migration error.

If `supabase db push` tries to replay migrations whose objects already exist (for example `ERROR: relation "profiles" already exists`), the fix is to record the existing ones in the CLI's history rather than to run them again:

```bash
supabase migration list --linked
```

```bash
supabase migration repair --status applied 20260101000000 20260101000001 20260101000002 20260814000001 20261021000000
```

Then `supabase db push` applies only the genuinely new migrations. `repair` does not check the schema, so confirm the objects those files create really do exist first.

For a manual Dashboard setup instead, open **SQL Editor → New query**, then paste and run the seven files above individually in the listed order. Confirm each succeeds before continuing. In **Table Editor**, verify the tables were created, including `profiles`, `courses`, `enrollments`, `venues`, `sessions`, `attendance_records`, `webauthn_credentials`, `webauthn_challenges`, and `enrolment_pins`.

For future schema changes, add a timestamped `.sql` migration under `supabase/migrations/`, then review it with `supabase db push --dry-run` before applying it. Keep a single copy of each migration in this directory.

### 3. Configure environment variables

Create two local files: `.env` in the repository root for Vite, and `server/.env` for Express. The repository's `.gitignore` excludes `.env` files; keep real credentials out of source control and chat logs.

**Repository root `.env` (frontend):**

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<supabase-anon-or-publishable-key>
VITE_API_URL=http://localhost:3001
```

**`server/.env` (backend):**

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<supabase-anon-or-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<supabase-service-role-key>
QR_JWT_SECRET=<generate-a-random-secret-at-least-32-characters-long>
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:5173
WEBAUTHN_RP_NAME=Attendance System
CORS_ORIGIN=http://localhost:5173
PORT=3001
```

`SUPABASE_ANON_KEY` is needed by the backend's user-scoped Supabase client. `SUPABASE_SERVICE_ROLE_KEY` is used only by trusted API routes and bypasses RLS. Never copy it to the root `.env`, rename it to a `VITE_` variable, or expose it in frontend settings. The browser key is public by design; RLS policies, not secrecy of that key, protect user data.

Generate a strong QR signing secret locally with Node.js:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Generate a different value for each environment (local, staging, production). Do not reuse the Supabase database password as the QR secret.

Vite embeds `VITE_` variables into the frontend build. Set them before `npm run build`; changing them in a host's dashboard does not update an already-built frontend until you redeploy it.

### 4. Deploy the Express API

The root `vercel.json` configures the frontend single-page app, not the Express API. Deploy the `server/` directory separately to a Node.js application host that supports long-running Express processes.

Configure the API host with these environment variables:

| Variable | Production value |
|---|---|
| `SUPABASE_URL` | The same Supabase project URL used by the frontend |
| `SUPABASE_ANON_KEY` | The same anon/public key used by the frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | The Supabase service-role key; secret server-side setting only |
| `QR_JWT_SECRET` | A securely generated random secret (at least 32 characters) |
| `WEBAUTHN_RP_ID` | The frontend's hostname only, e.g. `attendance.example.com` (no scheme or path) |
| `WEBAUTHN_ORIGIN` | The frontend's full origin, e.g. `https://attendance.example.com` |
| `WEBAUTHN_RP_NAME` | Human-readable name shown during passkey registration |
| `CORS_ORIGIN` | The exact frontend origin, e.g. `https://attendance.example.com` |
| `PORT` | Usually set automatically by the host; otherwise use the port configured for the API |

The server derives WebAuthn RP ID and origin from the incoming browser `Origin`/`Referer` when available. Set the explicit values as matching production fallbacks. Passkeys require HTTPS in production (except on localhost), and the RP ID must match the hostname used to open the frontend. If the app is served from a custom domain, register that domain as the RP ID.

Set the API host's build/start commands to:

```text
Build:  npm install && npm run build
Start:  npm start
```

For a monorepo host, set its working directory/root directory to `server`. After deployment, verify `https://<api-host>/api/health` returns JSON with `"status":"ok"`.

### 5. Deploy the frontend

The included `vercel.json` provides an SPA rewrite, so Vercel can host the Vite frontend from the repository root. Configure the root directory as the repository root, then add these environment variables in the frontend host's project settings:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<supabase-anon-or-publishable-key>
VITE_API_URL=https://<api-host>
```

`VITE_API_URL` is the API base URL only: do not append `/api` or a route. The client adds `/api/<route>` itself. Redeploy the frontend after adding or changing build environment variables. The API's `CORS_ORIGIN` should match the exact production frontend origin, including `https://` and any custom domain.

### 6. Configure Supabase Auth and verify

1. In **Authentication → URL Configuration**, set the production frontend URL as the **Site URL** and add it to the allowed redirect URLs. Add local development URLs if needed.
2. Ensure email/password authentication is enabled if using the included sign-in and sign-up pages. Configure email confirmation to match your deployment and testing requirements.
3. Sign up a test account and verify its `profiles` row was created with the intended role. The frontend's role-specific screens depend on this profile.
4. Test a lecturer workflow (course, venue, session), then a student check-in. Use HTTPS and a supported browser/device for passkey registration.
5. Check API logs, browser console/network requests, and Supabase logs if a request fails. Confirm that no service-role key appears in frontend source, browser developer tools, or build output.

### Local Setup & Development

Prerequisites: Node.js (v18+) and npm, plus a Supabase project configured using the steps above.

Install and run the API from one terminal:

```powershell
cd server
npm install
npm run dev
```

Run the frontend from a second terminal at the repository root:

```powershell
npm install
npm run dev
```

The frontend is available at `http://localhost:5173` and the API at `http://localhost:3001`. To test the production build and Service Worker locally, run `npm run build` followed by `npm run preview` from the root.

---

## 👨‍🏫 Usage Flow

### Lecturer
1. Log in and navigate to **Courses** to add subjects and set minimum attendance thresholds.
2. Navigate to **Venues** to configure classrooms and GPS geofences.
3. Start a new **Session**, select the required verification mode, and project the live QR code.
4. Monitor the live attendance dashboard and "At-Risk" student alerts.
5. Generate advanced CSV reports via the **Reports** page.

### Student
1. Log in using your matriculation number.
2. Navigate to **Enrol Biometrics** and enter the PIN provided by your lecturer to register your device passkey.
3. At class, go to **Check In**, scan the QR code, grant location access, and authenticate with your fingerprint/FaceID.
4. Track your personal attendance percentages on the **Attendance** dashboard.