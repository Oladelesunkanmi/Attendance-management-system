/**
 * Resolves WebAuthn RP ID and Origin dynamically:
 * 1. Explicitly passed in body (e.g. window.location.hostname from client)
 * 2. Origin / Referer HTTP header from request
 * 3. Environment variables (WEBAUTHN_RP_ID, WEBAUTHN_ORIGIN)
 * 4. Safe fallback to localhost / http://localhost:5173
 */
export function getWebauthnConfig(req?: Request, explicitRpID?: string, explicitOrigin?: string) {
  const envRpID = Deno.env.get('WEBAUTHN_RP_ID');
  const envOrigin = Deno.env.get('WEBAUTHN_ORIGIN');
  const rpName = Deno.env.get('WEBAUTHN_RP_NAME') ?? 'Attendance System';

  let derivedOrigin = explicitOrigin || envOrigin;
  let derivedRpID = explicitRpID || envRpID;

  if (req) {
    const originHeader = req.headers.get('origin') || req.headers.get('referer');
    if (originHeader) {
      try {
        const parsed = new URL(originHeader);
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

  const rpID = derivedRpID || 'localhost';
  const origin = derivedOrigin || 'http://localhost:5173';

  return { rpID, origin, rpName };
}
