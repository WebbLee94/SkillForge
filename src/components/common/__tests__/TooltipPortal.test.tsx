import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createRef } from 'react';
import { TooltipPortal } from '../TooltipPortal';

describe('TooltipPortal', () => {
  it('returns null when open is false', () => {
    const triggerRef = createRef<HTMLElement>();
    const { container } = render(
      <TooltipPortal open={false} triggerRef={triggerRef}>
        <span>工具提示内容</span>
      </TooltipPortal>
    );
    expect(document.body.innerHTML).not.toContain('工具提示内容');
    expect(container.innerHTML).toBe('');
  });

  it('renders portal to document.body when open is true', () => {
    const el = document.createElement('button');
    el.getBoundingClientRect = () => ({
      top: 100,
      left: 200,
      width: 80,
      height: 32,
      bottom: 132,
      right: 280,
    } as DOMRect);
    const triggerRef = { current: el };

    render(
      <TooltipPortal open={true} triggerRef={triggerRef}>
        <span>悬浮提示</span>
      </TooltipPortal>
    );

    expect(document.body.innerHTML).toContain('悬浮提示');
  });

  it('positions portal based on trigger rect and offsetY', () => {
    const el = document.createElement('button');
    el.getBoundingClientRect = () => ({
      top: 100,
      left: 200,
      width: 80,
      height: 32,
      bottom: 132,
      right: 280,
    } as DOMRect);
    const triggerRef = { current: el };

    render(
      <TooltipPortal open={true} triggerRef={triggerRef} offsetY={12}>
        <span>定位测试</span>
      </TooltipPortal>
    );

    const portalDiv = document.body.querySelector('div.fixed');
    expect(portalDiv).toBeDefined();
    expect(portalDiv?.getAttribute('style')).toContain('top: 144px');
    expect(portalDiv?.getAttribute('style')).toContain('left: 240px');
  });

  it('applies default offsetY of 8 when not specified', () => {
    const el = document.createElement('button');
    el.getBoundingClientRect = () => ({
      top: 100,
      left: 200,
      width: 80,
      height: 32,
      bottom: 132,
      right: 280,
    } as DOMRect);
    const triggerRef = { current: el };

    render(
      <TooltipPortal open={true} triggerRef={triggerRef}>
        <span>默认偏移</span>
      </TooltipPortal>
    );

    const portalDiv = document.body.querySelector('div.fixed');
    expect(portalDiv?.getAttribute('style')).toContain('top: 140px');
  });

  it('has pointer-events-none class', () => {
    const el = document.createElement('button');
    el.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      width: 100,
      height: 30,
      bottom: 30,
      right: 100,
    } as DOMRect);
    const triggerRef = { current: el };

    render(
      <TooltipPortal open={true} triggerRef={triggerRef}>
        <span>不拦截点击</span>
      </TooltipPortal>
    );

    const portalDiv = document.body.querySelector('div.fixed');
    expect(portalDiv?.className).toContain('pointer-events-none');
  });

  it('renders children inside portal popover', () => {
    const el = document.createElement('button');
    el.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      width: 100,
      height: 30,
      bottom: 30,
      right: 100,
    } as DOMRect);
    const triggerRef = { current: el };

    render(
      <TooltipPortal open={true} triggerRef={triggerRef}>
        <div className="custom-content">复杂内容</div>
      </TooltipPortal>
    );

    expect(document.body.innerHTML).toContain('复杂内容');
    const content = document.body.querySelector('.custom-content');
    expect(content).toBeDefined();
  });
});
