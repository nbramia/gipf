// Accessible-dialog behavior for an overlay that is always mounted: while
// `active`, move focus inside `ref`, keep Tab within it, close on Escape, and
// hand focus back to whatever opened it.

import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function useModalFocus(active, ref, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return undefined;
    const opener = document.activeElement;
    const items = () => (ref.current ? Array.from(ref.current.querySelectorAll(FOCUSABLE)) : []);
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
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, [active, ref]);
}
