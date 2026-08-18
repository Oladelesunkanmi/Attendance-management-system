### Summary

This PR fixes a bug where student check-in always asked for GPS and WebAuthn (biometric) even when the session was configured as `qr_only`. The client now decodes the QR JWT to get the `session_id`, fetches the session's `verification_mode`, and conditionally runs GPS and WebAuthn. The server-side edge function now validates and evaluates fields according to the session mode.

### Changes

- Server: supabase/functions/verify-checkin/index.ts
  - Only require latitude/longitude when session.verification_mode !== 'qr_only'
  - Only evaluate GPS flags when GPS data is provided
  - Enforce WebAuthn only when verification_mode === 'full'
  - Store null lat/long/gpsAccuracy for qr_only records

- Client: src/pages/student/CheckInPage.tsx
  - Decode QR JWT to extract session_id (client-side decode only, server still validates QR)
  - Fetch session.verification_mode from Supabase
  - Conditionally run GPS and WebAuthn flows
  - Build dynamic payload containing only required fields
  - UI: added 'fetching_mode' step and mode-aware pipeline indicator

- Queue: src/lib/queue.ts
  - Made latitude/longitude/gpsAccuracy optional for queued check-ins

### Manual verification
(See PR_DESCRIPTION.md in this branch for the full checklist.)

### Notes
- The server remains authoritative: it fully validates the QR token and enforces verification_mode. Client-side JWT decode is only used to fetch the session record.

