import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './LandingPage.jsx';

const YinshGame = lazy(() => import('./games/yinsh/YinshGame.jsx'));
const ZertzGame = lazy(() => import('./games/zertz/ZertzGame.jsx'));
const ChessGame = lazy(() => import('./games/chess/ChessGame.jsx'));
const CatanGame = lazy(() => import('./games/catan/CatanGame.jsx'));
const SplendorGame = lazy(() => import('./games/splendor/SplendorGame.jsx'));
const DiplomacyGame = lazy(() => import('./games/diplomacy/DiplomacyGame.jsx'));

function App() {
  return (
    <BrowserRouter>
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
