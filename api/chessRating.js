// Legacy unauthenticated reads/writes are retired. Claim through chessProfile.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({ error: 'account_required' });
}
