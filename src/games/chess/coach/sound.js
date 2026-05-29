// sound.js — tiny WebAudio move/capture/check/end cues (#21).
//
// Synthesised with an oscillator so there are no audio asset files to ship. All
// calls are no-ops when sound is disabled or WebAudio is unavailable. Kept out
// of the Board (pure logic) and behind a user toggle (off by default).

let ctx = null;

function audioCtx() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

function tone(freq, durationMs, type = 'sine', gain = 0.06) {
  const ac = audioCtx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g);
  g.connect(ac.destination);
  const now = ac.currentTime;
  osc.start(now);
  // Quick fade-out to avoid clicks.
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.stop(now + durationMs / 1000);
}

// kind: 'move' | 'capture' | 'check' | 'end'
export function playSound(kind) {
  switch (kind) {
    case 'move':
      tone(440, 70, 'sine');
      break;
    case 'capture':
      tone(300, 90, 'triangle', 0.08);
      break;
    case 'check':
      tone(660, 120, 'square', 0.05);
      break;
    case 'end':
      tone(523, 160, 'sine');
      setTimeout(() => tone(392, 200, 'sine'), 140);
      break;
    default:
      break;
  }
}

// Classify a chess.js verbose move into a sound kind (check beats capture).
export function moveSoundKind(move, isCheck, isGameOver) {
  if (isGameOver) return 'end';
  if (isCheck) return 'check';
  if (move && (move.flags.includes('c') || move.flags.includes('e'))) return 'capture';
  return 'move';
}
