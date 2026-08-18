---
Title: fix(checkin): respect session verification_mode (skip GPS/WebAuthn for qr_only)

Summary:
This PR fixes a bug where the student check-in flow always forced GPS and WebAuthn (biometric) collection, even when the lecturer configured the session to require QR-only verification. The changes ensure the client fetches the session verification_mode after decoding the QR token and only runs GPS and/or WebAuthn when required. The server-side edge function is updated to validate fields according to the session mode and only evaluate GPS flags when GPS data is present.

Files changed:
- supabase/functions/verify-checkin/index.ts
- src/pages/student/CheckInPage.tsx
- src/lib/queue.ts

Key behaviour changes:
- QR-only sessions no longer prompt for GPS or biometric data.
- Geofence and full modes continue to require GPS; full mode also requires WebAuthn.
- Offline queueing supports QR-only check-ins by allowing missing GPS fields.

Manual verification checklist:
1. Create sessions in the app with each verification_mode: `qr_only`, `qr_geofence`, and `full`.
2. For each session mode, perform a student check-in and verify:
   - `qr_only`: No GPS permission prompt, no biometric prompt. Pipeline shows 2 steps (QR → Server). Attendance recorded successfully.
   - `qr_geofence`: GPS prompt appears, no biometric prompt. Pipeline shows 3 steps (QR → GPS → Server). Server evaluates geofence.
   - `full`: GPS prompt then biometric prompt. Pipeline shows 4 steps (QR → GPS → Biometric → Server). Server evaluates geofence and WebAuthn.
3. Offline checks: with network disabled, scan and ensure the queued payload contains only the fields required for that mode (qrToken only for `qr_only`), and verify sync on reconnect.
4. Edge function validation:
   - `qr_only` request without latitude/longitude should succeed.
   - `qr_geofence` request without latitude/longitude should return 400 with a helpful message.
   - `full` request without `assertionResponse` should return 400.

Notes:
- The client decodes the QR JWT payload client-side only to read `session_id`; the server still cryptographically validates the QR token and enforces all verification rules.
- I made minimal UI changes: the verification pipeline now reflects the session mode and shows a brief fetching state.

CI/tests:
- I recommend adding unit tests for the edge function verifying required fields per mode. I can add them in a follow-up commit or include them in this PR if you want.

