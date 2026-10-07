import './storageRenameOnLoad.js';
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { discardUnreadableSession, expireRejectedSession } from './account.js';

// /migration is a local export/staging page that makes no request until asked to.
const migrationPage = window.location.pathname === '/migration';

discardUnreadableSession();
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
// A session the server no longer honours is signed out like any other sign-out.
if (!migrationPage) expireRejectedSession().then(expired => { if (expired) window.location.reload(); }).catch(() => {});
