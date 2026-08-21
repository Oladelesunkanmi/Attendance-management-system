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

## 💻 Local Setup & Development

### Prerequisites
- **Node.js** (v18+) & `npm`
- A **Supabase** project (for database hosting)

### 1. Database Setup
Ensure your Supabase PostgreSQL database contains the required schema (`profiles`, `courses`, `enrollments`, `venues`, `sessions`, `attendance_records`, `webauthn_credentials`, `enrolment_pins`). 

### 2. Environment Variables

Create `.env` files in both the root directory and the `server/` directory based on the provided examples.

**Root (`/.env`) - Frontend Variables:**
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=http://localhost:3001
```

**Backend (`/server/.env`) - Backend Variables:**
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
QR_JWT_SECRET=super-secret-random-jwt-key-minimum-32-chars
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:5173
WEBAUTHN_RP_NAME="Attendance System"
```

### 3. Start the Backend API (Express)
Open a terminal, navigate to the `server` directory, install dependencies, and start the development server:
```bash
cd server
npm install
npm run dev
```
*The API will run on port 3001.*

### 4. Start the Frontend (Vite)
Open a new terminal in the project root, install dependencies, and start the frontend:
```bash
npm install
npm run dev
```
*The app will be available at http://localhost:5173.*

To test Service Worker offline features locally, run:
```bash
npm run build
npm run preview
```

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