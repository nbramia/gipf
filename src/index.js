import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { upgradeLegacySession, expireRejectedSession } from './account.js';

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

// A cached v1 session is swapped for a session cookie before anything mounts, so no
// component captures the old identity. The upgrade is bounded; play never waits on it long.
let rendered = false;
const upgrade = migrationPage ? Promise.resolve(false) : upgradeLegacySession({ canCommit: () => !rendered }).catch(() => false);
Promise.race([upgrade, new Promise(resolve => setTimeout(resolve, 6000))])
  .finally(() => {
    rendered = true;
    render();
    // A session the server no longer honours is signed out like any other sign-out.
    if (!migrationPage) expireRejectedSession().then(expired => { if (expired) window.location.reload(); }).catch(() => {});
  });
