/**
 * Prints a session QR token (and optionally writes it as a PNG) that can be
 * shown to a phone to exercise the scanning path on a real device.
 *
 * Usage:  node tools/make-test-qr.mjs [verificationMode]
 */
import QRCode from 'qrcode';

const mode = process.argv[2] || 'full';
const payload = {
  session_id: 'test-session-0001',
  verification_mode: mode,
  exp: Math.floor(Date.now() / 1000) + 300,
};
const token = `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

console.log(token);
await QRCode.toFile('tools/test-qr.png', token, { margin: 2, width: 600 });
console.log('wrote tools/test-qr.png');
