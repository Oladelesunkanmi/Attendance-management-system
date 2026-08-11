# QR + Geofence + WebAuthn Attendance System

React PWA frontend with Supabase Postgres, Auth, Row Level Security, Edge Functions, and Service Worker Offline Sync.

## Stack

- **Frontend:** React (Vite) + Tailwind CSS + PWA (Custom Service Worker + IndexedDB)
- **Backend:** Supabase Edge Functions (Deno/TypeScript)
- **Database:** Supabase Postgres with RLS
- **Hosting:** Vercel (frontend) + Supabase (backend/DB)

## Project Structure

```
attendance-system/
├── src/                         # React PWA
│   ├── lib/                     # Supabase client, Geo helpers, IDB queue
│   ├── pages/                   # Student & Lecturer pages
│   └── sw.ts                    # Service Worker (Offline sync + JWT TTL check)
├── supabase/
│   ├── migrations/              # SQL schema + RLS policies
│   └── functions/               # Edge Functions
│       ├── issue-qr-token/
│       ├── verify-checkin/
│       ├── webauthn-register/
│       └── webauthn-authenticate/
```

---

## How to Start the System

### Prerequisites

- Node.js (v18+) & `npm`
- [Supabase CLI](https://supabase.com/docs/guides/cli) installed (for local backend development/deployment)

### 1. Local Quick Start (Development Mode)

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Set Up Environment Variables:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Fill in your Supabase details:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

3. **Start Development Server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173` in your browser.

---

### 2. Testing Offline Sync & PWA Service Worker

To test Service Worker features (Offline Queueing & Background Sync):

```bash
npm run build
npm run preview
```
Open `http://localhost:4173` (or the URL shown by Vite preview).

---

### 3. Backend & Supabase Setup

#### Option A: Cloud Supabase Project

1. **Create Supabase Project:** Go to [supabase.com](https://supabase.com) and create a project.
2. **Apply Migrations:** Run the migration files in order via the Supabase SQL Editor:
   - `supabase/migrations/20260101000000_initial_schema.sql`
   - `supabase/migrations/20260101000001_rls_policies.sql`
   - `supabase/migrations/20260101000002_webauthn_challenges.sql`

3. **Set Edge Function Secrets (Supabase Dashboard → Functions → Secrets):**
   - `SUPABASE_URL`: `https://your-project.supabase.co`
   - `SUPABASE_ANON_KEY`: `your-anon-key`
   - `SUPABASE_SERVICE_ROLE_KEY`: `your-service-role-key`
   - `QR_JWT_SECRET`: `your-random-jwt-secret`
   - `WEBAUTHN_RP_ID`: `localhost` (or `your-app.vercel.app` for production)
   - `WEBAUTHN_ORIGIN`: `http://localhost:5173` (or `https://your-app.vercel.app`)

4. **Deploy Edge Functions:**
   ```bash
   supabase login
   supabase link --project-ref your-project-ref
   supabase functions deploy issue-qr-token
   supabase functions deploy verify-checkin
   supabase functions deploy webauthn-register
   supabase functions deploy webauthn-authenticate
   ```

#### Option B: Local Supabase Stack

1. **Start Local Supabase:**
   ```bash
   supabase start
   ```
2. **Serve Edge Functions Locally:**
   ```bash
   supabase functions serve --env-file supabase/functions/.env.local
   ```

---

## Usage Flow

### Lecturer Flow

1. Sign up / Log in as **Lecturer**.
2. Navigate to **Courses** and add a course.
3. Navigate to **Venues** and set classroom coordinates (or use "Use current GPS").
4. Navigate to **Sessions** and start a new session (Choose verification mode: `qr_only`, `qr_geofence`, or `full`).
5. Display the auto-rotating QR code on screen and view live check-ins via Supabase Realtime.
6. Export session attendance as CSV.

### Student Flow

1. Sign up / Log in as **Student** (with matriculation number).
2. Complete **WebAuthn Enrolment** (bind physical device / biometrics).
3. At class, go to **Check In**:
   - Scan the rotating session QR code.
   - Grant GPS location access.
   - Verify identity using biometric prompt (WebAuthn).
   - If offline or on poor network, check-in is queued locally in IndexedDB and automatically synced when reconnected.

---

## Verification Modes

Each session supports selectable verification modes:

| Mode | Verification Checks |
|---|---|
| `qr_only` | Rotating QR Token only (30s TTL) |
| `qr_geofence` | QR Token + GPS Geofence Haversine Check |
| `full` | QR Token + GPS Geofence + WebAuthn Biometric Verification |

---

## Completed Build Plan Progress

- [x] **Phase 0**: Project setup & PWA scaffold
- [x] **Phase 1**: Database schema & RLS policies
- [x] **Phase 2**: Auth & Role-based routes
- [x] **Phase 3**: WebAuthn enrolment flow
- [x] **Phase 4**: WebAuthn check-in verification
- [x] **Phase 5**: Rotating QR token generation & scanner
- [x] **Phase 6**: GPS Haversine geofence & accuracy checks
- [x] **Phase 7**: Combined atomic `/verify-checkin` Edge Function
- [x] **Phase 8**: Client-side IndexedDB queue & SW Background Sync
