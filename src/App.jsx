import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './LandingPage.jsx';

const YinshGame = lazy(() => import('./games/yinsh/YinshGame.jsx'));
const ZertzGame = lazy(() => import('./games/zertz/ZertzGame.jsx'));
const ChessGame = lazy(() => import('./games/chess/ChessGame.jsx'));
const CatanGame = lazy(() => import('./games/catan/CatanGame.jsx'));
const SplendorGame = lazy(() => import('./games/splendor/SplendorGame.jsx'));
const DiplomacyGame = lazy(() => import('./games/diplomacy/DiplomacyGame.jsx'));

// The app is served from a subdirectory (`ramia.us/gipf`) as well as from its own domain
// root. `PUBLIC_URL` carries whichever prefix the build was made for — the `homepage` field
// when there is one, an empty string when there is not — so a single build works in both
// places and neither has the prefix written into it.
function App() {
  return (
    <BrowserRouter basename={process.env.PUBLIC_URL}>
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-neutral-900 text-neutral-400 font-body">Loading...</div>}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/yinsh" element={<YinshGame />} />
          <Route path="/zertz" element={<ZertzGame />} />
          <Route path="/chess" element={<ChessGame />} />
          <Route path="/catan" element={<CatanGame />} />
          <Route path="/splendor" element={<SplendorGame />} />
          <Route path="/diplomacy" element={<DiplomacyGame />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
