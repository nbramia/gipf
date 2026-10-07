// richText.jsx — renders the small markdown subset the coach model tends to
// emit (**bold**, *italic*, `code`, line breaks, bullet and numbered lists) as
// React elements. Text is only ever placed in text nodes, never parsed as
// HTML, so model output (or anything echoed into it) cannot inject markup.

import React from 'react';

// Recursive inline parser: `code` (literal), ***both*** / ___both___,
// **bold** / __bold__, *italic*. Emphasis nests. A closer is the first
// delimiter whose inner text parses cleanly (no stray emphasis marker left
// over), so adjacent closing runs such as `**A *x***` split innermost-first.
// An unclosed marker stays literal text.
function parseInline(text, keyBase) {
  const out = [];
  let buf = '';
  let n = 0;
  let dangling = false;
  const flush = () => {
    if (buf) out.push(buf);
    buf = '';
  };
  const push = (node) => {
    flush();
    out.push(node);
    n += 1;
  };
  // First closer for `delim` at/after `from` whose inner text is non-empty,
  // doesn't end in whitespace and parses with no dangling marker.
  const findClose = (delim, from, key) => {
    for (let j = text.indexOf(delim, from + 1); j !== -1; j = text.indexOf(delim, j + 1)) {
      if (/\s/.test(text[j - 1])) continue;
      const inner = parseInline(text.slice(from, j), key);
      if (!inner.dangling) return { j, nodes: inner.nodes };
    }
    return null;
  };
  let i = 0;
  while (i < text.length) {
    const key = `${keyBase}-${n}`;
    const c = text[i];
    let m = null;
    if (c === '`') {
      const close = text.indexOf('`', i + 1);
      if (close > i + 1) {
        push(<code key={key}>{text.slice(i + 1, close)}</code>);
        i = close + 1;
        continue;
      }
    }
    if (text.startsWith('***', i) || text.startsWith('___', i)) {
      m = findClose(text.slice(i, i + 3), i + 3, key);
      if (m) {
        push(<strong key={key}><em>{m.nodes}</em></strong>);
        i = m.j + 3;
        continue;
      }
    }
    if (text.startsWith('**', i) || text.startsWith('__', i)) {
      m = findClose(text.slice(i, i + 2), i + 2, key);
      if (m) {
        push(<strong key={key}>{m.nodes}</strong>);
        i = m.j + 2;
        continue;
      }
    }
    if (c === '*' && text[i + 1] && !/[\s*]/.test(text[i + 1])) {
      m = findClose('*', i + 1, key);
      if (m) {
        push(<em key={key}>{m.nodes}</em>);
        i = m.j + 1;
        continue;
      }
    }
    // A leftover marker char that isn't plain spaced text (e.g. "2 * 3").
    if ((c === '*' || c === '_') && !(/\s/.test(text[i - 1] || '') && /\s/.test(text[i + 1] || ''))) {
      if (c === '*' || text[i + 1] === '_' || text[i - 1] === '_') dangling = true;
    }
    buf += c;
    i += 1;
  }
  flush();
  return { nodes: out, dangling };
}

const inline = (text, keyBase) => parseInline(text, keyBase).nodes;

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function renderCoachText(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // { ordered, items }
  const gap = () => (out.length ? { marginTop: '0.4em' } : undefined);

  const flushPara = () => {
    if (!para.length) return;
    const key = `p${out.length}`;
    const kids = [];
    para.forEach((line, i) => {
      if (i) kids.push(<br key={`${key}-br${i}`} />);
      kids.push(...inline(line, `${key}-${i}`));
    });
    out.push(
      <div key={key} style={gap()}>
        {kids}
      </div>
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = `l${out.length}`;
    const items = list.items.map((it, i) => <li key={`${key}-${i}`}>{inline(it, `${key}-${i}`)}</li>);
    const style = { ...gap(), paddingLeft: '1.25em', listStyle: list.ordered ? 'decimal' : 'disc' };
    out.push(
      list.ordered ? (
        <ol key={key} style={style}>
          {items}
        </ol>
      ) : (
        <ul key={key} style={style}>
          {items}
        </ul>
      )
    );
    list = null;
  };

  for (const raw of lines) {
    const bullet = BULLET.exec(raw);
    const numbered = bullet ? null : NUMBERED.exec(raw);
    if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet || numbered)[1]);
      continue;
    }
    flushList();
    if (!raw.trim()) {
      flushPara();
      continue;
    }
    const heading = HEADING.exec(raw);
    para.push(heading ? `**${heading[1].replace(/\*+/g, '')}**` : raw);
  }
  flushPara();
  flushList();
  return out;
}

export function CoachText({ text }) {
  return <>{renderCoachText(text)}</>;
}
