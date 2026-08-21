import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createRef } from 'react';
import { AppLogo } from '../common/AppLogo';

describe('AppLogo', () => {
  it('renders SVG with default size 24', () => {
    const { container } = render(<AppLogo />);
    const svg = container.querySelector('svg');
    expect(svg).toBeDefined();
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('height')).toBe('24');
  });

  it('renders with custom size', () => {
    const { container } = render(<AppLogo size={48} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('48');
    expect(svg?.getAttribute('height')).toBe('48');
  });

  it('applies className to SVG', () => {
    const { container } = render(<AppLogo className="custom-logo" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('custom-logo');
  });

  it('has aria-label "SkillForge"', () => {
    render(<AppLogo />);
    const svg = document.querySelector('svg[aria-label="SkillForge"]');
    expect(svg).toBeDefined();
  });

  it('forwards ref to SVG element', () => {
    const ref = createRef<SVGSVGElement>();
    render(<AppLogo ref={ref} />);
    expect(ref.current).toBeInstanceOf(SVGSVGElement);
  });

  it('contains gradient defs and circle elements', () => {
    const { container } = render(<AppLogo />);
    expect(container.querySelector('defs')).toBeDefined();
    expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('path').length).toBeGreaterThanOrEqual(3);
  });
});
