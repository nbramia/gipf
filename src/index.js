import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { retireLegacySession, expireRejectedSession } from './account.js';

function render() {
  const root = createRoot(document.getElementById('root'));
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// /migration is a local export/staging page that makes no request until asked to.
const migrationPage = window.location.pathname === `${process.env.PUBLIC_URL || ''}/migration`;

// A password-era session is signed out before anything mounts, so no component
// captures an identity that can no longer sign in. Retiring it is local (the server
// revoke is not awaited), and play never waits on it long.
const retire = migrationPage ? Promise.resolve(false) : retireLegacySession().catch(() => false);
Promise.race([retire, new Promise(resolve => setTimeout(resolve, 6000))])
  .finally(() => {
    render();
    // A session the server no longer honours is signed out like any other sign-out.
    if (!migrationPage) expireRejectedSession().then(expired => { if (expired) window.location.reload(); }).catch(() => {});
  });
