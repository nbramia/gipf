import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from '../../src/LandingPage';

// Route destination is deliberately a stub; this fixture tests navigation, not game engines.
createRoot(document.getElementById('root')).render(
  <BrowserRouter basename="/gipf"><Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/:game" element={<h1>Guest game destination</h1>} />
  </Routes></BrowserRouter>
);
