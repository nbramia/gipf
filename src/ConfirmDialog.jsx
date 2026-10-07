import React, { useEffect, useRef } from 'react';

// Accessible confirmation: focus moves in (to Cancel, the safe choice), Tab stays
// inside, Escape or a click outside cancels, and focus returns to whatever
// opened it. `classes` lets each caller supply its own presentation.
export default function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel, classes = {}, overlayStyle }) {
  const ref = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    const cancel = ref.current && ref.current.querySelector('[data-confirm-cancel]');
    if (cancel) cancel.focus();
    return () => {
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    };
  }, []);
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...ref.current.querySelectorAll('button:not([disabled])')];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!ref.current.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div
      className={classes.overlay}
      style={overlayStyle}
      onClick={onCancel}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      ref={ref}
    >
      <div className={classes.panel} onClick={(ev) => ev.stopPropagation()}>
        <h3 className={classes.title}>{title}</h3>
        <p className={classes.body}>{body}</p>
        <div className={classes.actions}>
          <button type="button" data-confirm-cancel onClick={onCancel} className={classes.cancel}>Cancel</button>
          <button type="button" onClick={onConfirm} className={classes.confirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
