import React, { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(node => node.offsetParent !== null || node === document.activeElement);
}

// Accessible modal surface: dialog semantics, focus moves in on open, Tab stays
// inside, Escape closes, and focus returns to the opener on close. `overlayClassName`
// positions the panel (centered modal or right-hand drawer).
export default function Dialog({ label, onClose, overlayClassName, panelClassName, children }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement;
    const panel = panelRef.current;
    if (panel) {
      const [first] = focusableIn(panel);
      (first || panel).focus();
    }
    return () => {
      if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    };
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      closeRef.current?.();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const nodes = focusableIn(panelRef.current);
    if (nodes.length === 0) {
      event.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={overlayClassName}
      onClick={(event) => { if (event.target === event.currentTarget) closeRef.current?.(); }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={panelClassName}
      >
        {children}
      </div>
    </div>
  );
}

export function CloseButton({ label, onClick }) {
  return (
    <button type="button" className="catan-close-btn" aria-label={label} onClick={onClick}>
      <span aria-hidden="true">&times;</span>
    </button>
  );
}
