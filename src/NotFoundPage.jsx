import React from 'react';
import { Link } from 'react-router-dom';
import './landing.css';

export default function NotFoundPage() {
  return (
    <main className="landing-page">
      <div className="landing-shell">
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 40, fontWeight: 400 }}>Page not found</h1>
        <p style={{ margin: '12px 0 24px' }}>There is nothing at this address.</p>
        <Link className="landing-button landing-primary" to="/" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>Back to Games</Link>
      </div>
    </main>
  );
}
