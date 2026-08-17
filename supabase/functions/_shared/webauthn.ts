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
        if (!derivedOrigin || derivedOrigin.includes('localhost') || !derivedOrigin.startsWith('http')) {
          derivedOrigin = parsed.origin;
        }
        if (!derivedRpID || derivedRpID === 'localhost') {
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

/**
 * Encodes a Uint8Array into a PostgreSQL bytea hex string (`\x...`).
 * Required for Supabase PostgREST JSON payloads.
 */
export function encodeBytea(bytes: Uint8Array): string {
  return '\\x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parses a bytea value returned by Supabase PostgREST (hex string or Array) back into Uint8Array.
 */
export function parseBytea(val: unknown): Uint8Array {
  if (val instanceof Uint8Array) return val;
  if (Array.isArray(val)) return new Uint8Array(val);
  if (typeof val === 'string') {
    const clean = val.replace(/^\\x|^x/i, '');
    const matches = clean.match(/.{1,2}/g);
    return matches ? new Uint8Array(matches.map((b) => parseInt(b, 16))) : new Uint8Array();
  }
  return new Uint8Array();
}

