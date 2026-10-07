// richText.jsx — renders the small markdown subset the coach model tends to
// emit (**bold**, *italic*, `code`, line breaks, bullet and numbered lists) as
// React elements. Text is only ever placed in text nodes, never parsed as
// HTML, so model output (or anything echoed into it) cannot inject markup.

import React from 'react';

// Recursive inline parser: `code` (literal), ***both***, **bold** / __bold__,
// *italic*. Emphasis nests; an unclosed marker stays literal text.
function loneStar(text, from) {
  for (let j = from; j < text.length; j += 1) {
    if (text[j] === '*' && text[j - 1] !== '*' && text[j + 1] !== '*' && !/\s/.test(text[j - 1] || ' ')) return j;
  }
  return -1;
}

function inline(text, keyBase) {
  const out = [];
  let buf = '';
  let n = 0;
  const flush = () => {
    if (buf) out.push(buf);
    buf = '';
  };
  const push = (node) => {
    flush();
    out.push(node);
    n += 1;
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const key = `${keyBase}-${n}`;
    let close;
    if (rest[0] === '`' && (close = text.indexOf('`', i + 1)) > i + 1) {
      push(<code key={key}>{text.slice(i + 1, close)}</code>);
      i = close + 1;
    } else if (rest.startsWith('***') && (close = text.indexOf('***', i + 3)) > i + 3) {
      push(<strong key={key}><em>{inline(text.slice(i + 3, close), key)}</em></strong>);
      i = close + 3;
    } else if ((rest.startsWith('**') || rest.startsWith('__')) && (close = text.indexOf(rest.slice(0, 2), i + 2)) > i + 2) {
      push(<strong key={key}>{inline(text.slice(i + 2, close), key)}</strong>);
      i = close + 2;
    } else if (rest[0] === '*' && rest[1] && !/[\s*]/.test(rest[1]) && (close = loneStar(text, i + 2)) > 0) {
      push(<em key={key}>{inline(text.slice(i + 1, close), key)}</em>);
      i = close + 1;
    } else {
      buf += text[i];
      i += 1;
    }
  }
  flush();
  return out;
}

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
