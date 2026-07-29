/**
 * Gates this deployment behind a shared password, remembering a device once it answers.
 *
 * This gate exists so the games are not reachable at `gipf.vercel.app` while `ramia.us`
 * asks for a password — a rewrite routes traffic, it does not fence the origin off.
 *
 * The password lives in `SITE_PASSWORD`, never in the repo. The cookie holds a salted hash
 * of it rather than the password, so a stolen cookie reveals nothing and rotating the
 * variable signs every device out at once.
 *
 * The salt is shared across every project on this domain deliberately: one answer at
 * `ramia.us` satisfies the gate on each proxied project, so a device is asked once rather
 * than once per app. Keep these files identical — a divergent salt means a second prompt
 * on a path that already let you in.
 *
 * **Guess-rate limiting.** Verifying a cookie stays cheap, because it runs on every
 * request; the cost is placed on *submitting* a password instead. Each failure sleeps, and
 * an address that fails repeatedly is locked out for a while. The counter lives in the edge
 * isolate's memory, so it is best-effort rather than a guarantee — isolates are per-region
 * and recycled, and a distributed attacker sees several of them. It raises the cost of
 * hammering one endpoint by orders of magnitude, which is the realistic threat; it is not a
 * substitute for a strong secret.
 */

const COOKIE = 'ramia_gate'
const YEAR = 60 * 60 * 24 * 365

// Guess-rate limits. Deliberately loose enough that a person fat-fingering a password twice
// never notices, and tight enough that scripted guessing is pointless.
const MAX_FAILURES = 5
const WINDOW_MS = 60_000
const LOCKOUT_MS = 15 * 60_000
const FAILURE_DELAY_MS = 750

/** ip -> { count, windowStart, lockedUntil }. Per-isolate, so best-effort by design. */
const failures = new Map()

function clientIp(request) {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    'unknown'
  )
}

/** Returns remaining lockout in ms, or 0 when the address may try again. */
function lockoutRemaining(ip, now) {
  const rec = failures.get(ip)
  if (!rec?.lockedUntil) return 0
  if (now >= rec.lockedUntil) {
    failures.delete(ip)
    return 0
  }
  return rec.lockedUntil - now
}

function recordFailure(ip, now) {
  const rec = failures.get(ip)
  if (!rec || now - rec.windowStart > WINDOW_MS) {
    failures.set(ip, { count: 1, windowStart: now, lockedUntil: 0 })
    return
  }
  rec.count += 1
  if (rec.count >= MAX_FAILURES) rec.lockedUntil = now + LOCKOUT_MS
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Hex SHA-256, salted so the cookie is specific to this domain rather than to the password. */
async function token(secret) {
  const bytes = new TextEncoder().encode(`ramia-gate-v1:${secret}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Length-independent comparison, so a wrong guess leaks nothing through timing. */
function matches(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function page({ error, path }) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>GIPF Project</title>
<style>
  :root { --bg:#0f1117; --surface:#171a23; --border:#262b3a; --text:#e8eaf0; --dim:#9aa1b4; --accent:#e94560; }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f7f7f9; --surface:#fff; --border:#e2e4ec; --text:#16181f; --dim:#5c6377; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:1.5rem;
         background:var(--bg); color:var(--text);
         font:16px/1.5 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; }
  form { width:100%; max-width:22rem; background:var(--surface); border:1px solid var(--border);
         border-radius:12px; padding:1.75rem; }
  h1 { margin:0 0 .35rem; font-size:1.4rem; letter-spacing:-.02em; }
  p { margin:0 0 1.25rem; color:var(--dim); font-size:.92rem; }
  input { width:100%; padding:.7rem .85rem; font-size:1rem; color:var(--text);
          background:var(--bg); border:1px solid var(--border); border-radius:8px; }
  input:focus { outline:2px solid var(--accent); outline-offset:1px; }
  button { width:100%; margin-top:.75rem; padding:.7rem; font-size:1rem; font-weight:600;
           color:#fff; background:var(--accent); border:0; border-radius:8px; cursor:pointer; }
  .err { margin:.75rem 0 0; color:var(--accent); font-size:.88rem; }
</style>
</head><body>
<form method="POST" action="${path}">
  <h1>GIPF Project</h1>
  <p>These games are private. Enter the password to continue on this device.</p>
  <input type="password" name="password" autocomplete="current-password" autofocus
         aria-label="Password" required>
  <button type="submit">Continue</button>
  ${error ? `<p class="err">${error}</p>` : ''}
</form>
</body></html>`
}

const HTML = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, private' }

export default async function middleware(request) {
  const secret = process.env.SITE_PASSWORD
  // An unset variable would otherwise lock the site out of its own gate with no way back in.
  // This project holds nothing sensitive of its own, so an open moment beats a lockout.
  if (!secret) return undefined

  const url = new URL(request.url)
  const expected = await token(secret)

  // Cheap path first: this runs on every request, so it must stay a hash comparison.
  const cookie = request.headers.get('cookie') ?? ''
  const present = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))
  if (present && matches(present.slice(COOKIE.length + 1), expected)) return undefined

  const ip = clientIp(request)
  const now = Date.now()

  const locked = lockoutRemaining(ip, now)
  if (locked > 0) {
    return new Response(
      page({ error: `Too many attempts. Try again in ${Math.ceil(locked / 60000)} minutes.`, path: url.pathname }),
      { status: 429, headers: { ...HTML, 'retry-after': String(Math.ceil(locked / 1000)) } },
    )
  }

  if (request.method === 'POST') {
    const form = await request.formData()
    if (matches(String(form.get('password') ?? ''), secret)) {
      failures.delete(ip)
      // 303 so the browser re-issues the request as a GET; a 302 would repeat the POST.
      return new Response(null, {
        status: 303,
        headers: {
          location: url.pathname + url.search,
          'set-cookie': `${COOKIE}=${expected}; Path=/; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax`,
        },
      })
    }
    recordFailure(ip, now)
    await sleep(FAILURE_DELAY_MS)
    return new Response(page({ error: 'That password is not right.', path: url.pathname }), {
      status: 401,
      headers: HTML,
    })
  }

  return new Response(page({ path: url.pathname }), { status: 401, headers: HTML })
}

export const config = { matcher: ['/((?!favicon.ico).*)'] }
