// richText.jsx — renders the small markdown subset the coach model tends to
// emit (**bold**, *italic*, `code`, line breaks, bullet and numbered lists) as
// React elements. Text is only ever placed in text nodes, never parsed as
// HTML, so model output (or anything echoed into it) cannot inject markup.

import React from 'react';

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|`[^`]+`)/g;

function inline(text, keyBase) {
  return text
    .split(INLINE)
    .filter((p) => p !== '')
    .map((part, i) => {
      const key = `${keyBase}-${i}`;
      if (/^\*\*[^*]+\*\*$/.test(part) || /^__[^_]+__$/.test(part)) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }
      if (/^\*[^*\s][^*]*\*$/.test(part)) return <em key={key}>{part.slice(1, -1)}</em>;
      if (/^`[^`]+`$/.test(part)) return <code key={key}>{part.slice(1, -1)}</code>;
      return part;
    });
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
