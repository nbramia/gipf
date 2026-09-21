# Public Games catalogue

This presentation change is stacked on held accounts commit
`8ef678f5b61138ed6c57a5c91319c23622401894`. It does not approve accounts PR #61,
integrate saves PR #63, open public routing, or establish production readiness.

## Design

The catalogue comes first and the optional account area follows it. Six links
come directly from `games-registry.js`; React Router supplies the deployment base
path. Local, decorative SVG motifs evoke each board without importing its game
bundle or suggesting a saved position. There are no saved-status badges.

The handoff considered uniform tiles, full illustration, and a hybrid catalogue.
The hybrid keeps the scan speed of a directory and adds subject-specific pieces.
It uses paper `#FAFCFF`, ink `#17253D`, blue `#3156BA`, pale blue `#E8EFFA`,
pine `#24634F`, and slate `#526279`. Georgia carries the Games title; installed
Avenir Next/Trebuchet MS/sans-serif fonts carry navigation and body text.
No fonts or dependencies were added. All CSS is local to the landing page.

Desktop uses two columns; mobile uses one. The launch links are the first keyboard
stops, and each complete game entry is clickable. Account controls have visible
labels, password-manager autocomplete hints, visible focus, and announced errors.
Import consent starts unchecked and is presented only inside the account form.
Opening the form focuses Username; Cancel returns focus to the launcher. Native
form submission uses the displayed mode: Enter signs in or creates an account
only after password confirmation passes, and is blocked while busy. Explicit
Sign in and Create account buttons retain their existing behavior.
The existing account service handlers are unchanged, including creation,
credential encryption/decryption, importGuest, logout, and encrypted recovery.
Copy explicitly says progress and sync support vary by game.

## Focused verification

```sh
CI=true npm test -- --watchAll=false --runInBand --runTestsByPath src/LandingPage.test.jsx src/LandingPage.presentation.test.jsx
npm run build
node scripts/landing-fixture/serve.cjs
# Separate terminal, using an existing Playwright installation:
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/landing-fixture/check.cjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/landing-fixture/production-check.cjs
```

The fixture requires the existing CRA (`react-scripts@5.0.1`) dependency tree:
`webpack`, `style-loader`, and `css-loader` resolve as hoisted transitive packages,
not direct dependencies. Changes to CRA or dependency hoisting may make them
unavailable; no fixture dependencies were added. Playwright must also already
be installed at the supplied path.

The synthetic fixture loads `landing.css` without `src/index.css` or Tailwind
preflight, so its typography, spacing and computed-style checks do not establish
production styling parity. Use the actual production build for that comparison;
the separate production check below covers YINSH launch, not a full style audit.

The fixture aliases only the account module to a synthetic, sessionStorage-backed
boundary. Its game destination is a stub. The separate production check serves
the actual build at `/gipf` and opens the real YINSH guest board. Both block remote
traffic. Neither tests real account services, cryptography, provider integrations,
all game engines, or deployed routing/security. No real credentials are needed.

Screenshots are written to `/tmp/ramia22-games-design-evidence`. Browser checks
cover desktop, 480px and 320px widths, overflow, keyboard launch, account opening/Cancel focus, Enter submission in both
modes, login and signout,
password visibility, create confirmation/error/recovery text, import consent,
and reduced motion. The contrast assertion calculates literal palette hex pairs,
not styles sampled from the rendered page, so it does not detect CSS colour drift.
The focused React tests also assert calls to
the unchanged account boundaries. The full suite belongs to final verification.

## Screenshot critique

The original layout put an account/import prompt before the games and used dark,
generic cards. The new catalogue makes game selection the first action, keeps
descriptions readable, and concentrates illustration in small board motifs.
At 320px motifs shrink to preserve description width; the longer single-column
catalogue is intentional, so no games disappear into a carousel or collapsed list.

The first screenshot pass exposed a missing UTF-8 declaration in the standalone
fixture, corrected before final capture. A decorative closing slogan was removed.
The actual production build exposed Tailwind reset differences in account heading
weight, so explicit scoped typography was added. Contrast for tested text pairs is
at least 5.37:1, and focus uses a 3px blue outline. Motion is absent by default.

The inherited registry descriptions and account workflow remain authoritative;
this design is not a review of their backend guarantees. Parent security review,
save integration, full-suite verification and hosted checks remain release gates.
