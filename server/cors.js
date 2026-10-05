// CORS for the public API. The app calls its own origin, so production needs no CORS
// at all; the allowlist admits only local development servers. A request from any
// other origin gets no Access-Control-Allow-Origin header.
export const ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

export function applyCors(req, res) {
  const origin = req.headers?.origin;
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Games-Request');
}
