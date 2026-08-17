# Fix: Respect session verification_mode for student check-ins

This branch implements the fix described in the issue: ensure the student check-in flow only asks for GPS and WebAuthn when the session's verification_mode requires them.

Summary of changes:
- Server-side: relax validation in verify-checkin so `qr_only` does not require latitude/longitude and skip GPS flag evaluation for `qr_only`.
- Client-side: after scanning the QR token, decode it to extract `session_id`, fetch `sessions.verification_mode`, and conditionally run GPS/WebAuthn.
- Queue: make queued check-in GPS fields optional so `qr_only` check-ins can be queued without null latitude/longitude.

Manual verification checklist included in PR description.
