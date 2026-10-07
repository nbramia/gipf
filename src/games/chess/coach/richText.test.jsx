import React from 'react';
import { render } from '@testing-library/react';
import { CoachText } from './richText.jsx';

const html = (text) => {
  const { container } = render(<CoachText text={text} />);
  return container.innerHTML;
};

describe('CoachText', () => {
  test('renders bold, italic, code and hides markers', () => {
    const out = html('Play **Nf3** and *develop* with `O-O`.');
    expect(out).toContain('<strong>Nf3</strong>');
    expect(out).toContain('<em>develop</em>');
    expect(out).toContain('<code>O-O</code>');
    expect(out).not.toContain('*');
  });

  test('line breaks and lists', () => {
    const out = html('Ideas:\n- one\n- two\n\n1. first\n2. second');
    expect(out).toContain('<ul');
    expect(out.match(/<li>/g)).toHaveLength(4);
    expect(out).toContain('<ol');
    expect(html('a\nb')).toContain('<br>');
  });

  test('HTML in text is never injected', () => {
    const { container } = render(
      <CoachText text={'**x** <img src=x onerror=alert(1)> <script>bad()</script>'} />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  test('plain text and empty input pass through', () => {
    expect(html('2 * 3 is fine')).toContain('2 * 3 is fine');
    expect(html('')).toBe('');
  });
});
