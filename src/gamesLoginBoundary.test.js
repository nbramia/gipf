// /login is the only place credentials and keys are entered. This scans every
// game's shipped UI source so a sign-in form or key field cannot creep back in.
const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, 'games');
function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(jsx?|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
  });
}
const files = sources(GAMES_DIR).map(file => ({ file: path.relative(__dirname, file), text: fs.readFileSync(file, 'utf8') }));

const FORBIDDEN = [
  [/type=["']password["']/, 'a password-type input'],
  [/placeholder=["'](sk-ant|lip_)/, 'a key placeholder'],
  [/\b(deriveCredentials|createAccount|loginAccount|saveSession|clearSession|pushEncryptedKey)\b/, 'an account write'],
  [/\bsetApiKey\s*\(\s*[^)]/, 'a key write'],
  [/\bsetLichessToken\s*\(/, 'a Lichess token write'],
  [/Manage it on the home page|Synced to your API key|key in (the )?(Settings|Negotiation panel)|paste it under Settings/, 'stale account copy'],
];

test.each(FORBIDDEN)('no game UI source contains %s (%s)', (pattern) => {
  const offenders = files.filter(({ file, text }) => /\.jsx$/.test(file) && pattern.test(text)).map(({ file }) => file);
  expect(offenders).toEqual([]);
});

test.each(['chess', 'catan', 'splendor', 'diplomacy'])('%s links to /login with its own return route', game => {
  const linked = files.some(({ file, text }) => file.startsWith(`games/${game}/`) && text.includes(`loginHref('/${game}')`));
  expect(linked).toBe(true);
});
