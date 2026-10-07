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

  test('nested emphasis', () => {
    expect(html('**A *strong* move**')).toBe('<div><strong>A <em>strong</em> move</strong></div>');
    expect(html('***x***')).toBe('<div><strong><em>x</em></strong></div>');
    expect(html('__bold *italic*__')).toBe('<div><strong>bold <em>italic</em></strong></div>');
    expect(html('**open *never closed**')).not.toContain('<img');
    expect(html('*a **b** c*')).toContain('<strong>b</strong>');
  });

  test('adjacent closing runs split innermost-first', () => {
    expect(html('**A *strong move***')).toBe('<div><strong>A <em>strong move</em></strong></div>');
    expect(html('*A **strong move***')).toBe('<div><em>A <strong>strong move</strong></em></div>');
    expect(html('__A *strong move*__')).toBe('<div><strong>A <em>strong move</em></strong></div>');
    expect(html('___x___')).toBe('<div><strong><em>x</em></strong></div>');
  });

  test('HTML inside nested emphasis stays text', () => {
    const { container } = render(<CoachText text={'**a *<img src=x onerror=1>* b**'} />);
    expect(container.querySelector('img')).toBeNull();
  });
});
