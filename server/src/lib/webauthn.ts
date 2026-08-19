import type { Request } from 'express';

/**
 * Resolves WebAuthn RP ID and Origin dynamically from the incoming HTTP request,
 * with fallbacks to environment variables (WEBAUTHN_RP_ID, WEBAUTHN_ORIGIN).
 *
 * This prevents the browser error:
 * "The RP ID 'localhost' is invalid for this domain"
 * when deploying to Vercel or custom domains where the browser domain does not match 'localhost'.
 */
export function getWebauthnConfig(req?: Request) {
  let envRpID = process.env.WEBAUTHN_RP_ID;
  let envOrigin = process.env.WEBAUTHN_ORIGIN;
  const rpName = process.env.WEBAUTHN_RP_NAME ?? 'Attendance System';

  let derivedOrigin = envOrigin;
  let derivedRpID = envRpID;

  if (req) {
    const originHeader = req.headers.origin || req.headers.referer;
    if (originHeader) {
      try {
        const parsed = new URL(Array.isArray(originHeader) ? originHeader[0] : originHeader);
        // If env is missing, or if env was set to 'localhost' while the client is
        // accessing from a remote domain (e.g. Vercel)
        if (!derivedOrigin || (derivedOrigin.includes('localhost') && !parsed.hostname.includes('localhost'))) {
          derivedOrigin = parsed.origin;
        }
        if (!derivedRpID || (derivedRpID === 'localhost' && parsed.hostname !== 'localhost')) {
          derivedRpID = parsed.hostname;
        }
      } catch {
        // ignore invalid URL
      }
    }
  }

  // Final fallback defaults
  const rpID = derivedRpID || 'localhost';
  const origin = derivedOrigin || 'http://localhost:5173';

  return { rpID, origin, rpName };
}
