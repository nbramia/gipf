// Accessible-dialog behavior for an overlay that is always mounted: while
// `active`, move focus inside `ref`, keep Tab within it, make everything
// outside it inert, close on Escape, and hand focus back to whatever opened it.

import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Marks every sibling along the path from `el` up to <body> inert + aria-hidden
// (the dialog's own ancestors stay live). Returns an undo function. Elements
// with `data-modal-keep` (backdrops that close the dialog on click) are skipped.
function isolate(el) {
  const changed = [];
  let node = el;
  while (node && node.parentElement && node !== document.body) {
    for (const sib of node.parentElement.children) {
      if (sib === node || sib.hasAttribute('data-modal-keep')) continue;
      if (['SCRIPT', 'STYLE', 'LINK'].includes(sib.tagName)) continue;
      changed.push([sib, sib.hasAttribute('inert'), sib.getAttribute('aria-hidden')]);
      sib.setAttribute('inert', '');
      sib.setAttribute('aria-hidden', 'true');
    }
    node = node.parentElement;
  }
  return () => {
    for (const [sib, hadInert, hidden] of changed) {
      if (!hadInert) sib.removeAttribute('inert');
      if (hidden == null) sib.removeAttribute('aria-hidden');
      else sib.setAttribute('aria-hidden', hidden);
    }
  };
}

export default function useModalFocus(active, ref, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active || !ref.current) return undefined;
    const opener = document.activeElement;
    const items = () => (ref.current ? Array.from(ref.current.querySelectorAll(FOCUSABLE)) : []);
    const undoIsolate = isolate(ref.current);
    const first = items()[0];
    if (first) first.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (closeRef.current) closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = items();
      if (list.length === 0) { e.preventDefault(); return; }
      const inside = ref.current && ref.current.contains(document.activeElement);
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (!inside) { e.preventDefault(); (e.shiftKey ? lastEl : firstEl).focus(); }
      else if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    // Programmatic focus that lands outside is pulled back in.
    const onFocusIn = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        const f = items()[0];
        if (f) f.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn);
      undoIsolate();
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, [active, ref]);
}
