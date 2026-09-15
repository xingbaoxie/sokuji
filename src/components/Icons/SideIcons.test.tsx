import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SideMeIcon, SideOtherIcon, SideBothIcon } from './SideIcons';
import type { DisplayMode } from '../../stores/settingsStore';

// There are three glyphs and three files. The files pin the geometry — the
// only thing a designer owns — and the mode is a fill toggle over that same
// geometry, which is pinned here instead of in eight near-identical assets.

const svgFile = (name: string) =>
  new DOMParser().parseFromString(
    readFileSync(resolve(__dirname, 'side', `${name}.svg`), 'utf8'),
    'image/svg+xml',
  );

const pathsOf = (root: ParentNode) =>
  Array.from(root.querySelectorAll('path')).map((p) => ({
    cls: p.getAttribute('class'),
    d: p.getAttribute('d'),
    fill: p.getAttribute('fill'),
    stroke: p.getAttribute('stroke'),
    strokeWidth: p.getAttribute('stroke-width'),
  }));

const MODES: DisplayMode[] = ['both', 'translation', 'source', 'none'];

// [upper line, lower line] — upper is the original, lower is the translation.
const EXPECTED_FILLS: Record<DisplayMode, [string, string]> = {
  both: ['currentColor', 'currentColor'],
  translation: ['none', 'currentColor'],
  source: ['currentColor', 'none'],
  none: ['none', 'none'],
};

describe('SideIcons', () => {
  it('render one svg with exactly two paths and a data-icon name', () => {
    for (const [Icon, name] of [[SideMeIcon, 'side-me'], [SideOtherIcon, 'side-other'], [SideBothIcon, 'side-both']] as const) {
      const { container } = render(<Icon />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('data-icon')).toBe(name);
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.querySelectorAll('path')).toHaveLength(2);
    }
  });

  it('size sets width and height, default 24', () => {
    const { container } = render(<SideMeIcon size={14} />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '14');
    expect(container.querySelector('svg')).toHaveAttribute('height', '14');
    const def = render(<SideOtherIcon />).container.querySelector('svg')!;
    expect(def.getAttribute('width')).toBe('24');
  });

  it('each component reproduces its designer file exactly', () => {
    for (const [Icon, name] of [[SideMeIcon, 'side-me'], [SideOtherIcon, 'side-other'], [SideBothIcon, 'side-both']] as const) {
      const { container } = render(<Icon />);
      expect(pathsOf(container), name).toEqual(pathsOf(svgFile(name)));
    }
  });

  it('the mode changes only the fills, never the geometry', () => {
    for (const [Icon, name] of [[SideMeIcon, 'side-me'], [SideOtherIcon, 'side-other']] as const) {
      const reference = pathsOf(svgFile(name));
      for (const mode of MODES) {
        const got = pathsOf(render(<Icon mode={mode} />).container);
        expect(got.map((p) => p.d), `${name}--${mode} geometry`).toEqual(reference.map((p) => p.d));
        expect(got.map((p) => p.cls), `${name}--${mode} classes`).toEqual(reference.map((p) => p.cls));
        expect(got.map((p) => p.stroke), `${name}--${mode} stroke`).toEqual(reference.map((p) => p.stroke));
        expect(got.map((p) => p.strokeWidth), `${name}--${mode} stroke-width`).toEqual(reference.map((p) => p.strokeWidth));
        expect(got.map((p) => p.fill), `${name}--${mode} fills`).toEqual(EXPECTED_FILLS[mode]);
      }
    }
  });

  it('Both is always fully shown and names its paths by side', () => {
    const { container } = render(<SideBothIcon />);
    for (const p of pathsOf(container)) expect(p.fill).toBe('currentColor');
    expect(pathsOf(container).map((p) => p.cls)).toEqual(['side-other', 'side-me']);
  });

  it('Both reuses the Me and Other geometry rather than a third drawing', () => {
    const both = pathsOf(render(<SideBothIcon />).container);
    const me = pathsOf(render(<SideMeIcon />).container);
    const other = pathsOf(render(<SideOtherIcon />).container);
    expect(both[0].d, 'upper bubble is Other’s').toBe(other[0].d);
    expect(both[1].d, 'lower bubble is Me’s').toBe(me[1].d);
  });
});
