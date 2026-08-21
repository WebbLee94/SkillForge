import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../common/ErrorBoundary';

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('正常内容')).toBeDefined();
  });

  it('renders error fallback when child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const ThrowError = () => {
      throw new Error('测试错误信息');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );
    expect(screen.getByText('应用出现了错误')).toBeDefined();
    expect(screen.getByText('测试错误信息')).toBeDefined();
    expect(screen.getByText('重新加载')).toBeDefined();

    vi.mocked(console.error).mockRestore();
  });

  it('renders generic message when error has no message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const ThrowError = () => {
      throw new Error();
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );
    expect(screen.getByText('发生了意外错误，请尝试重新加载。')).toBeDefined();

    vi.mocked(console.error).mockRestore();
  });

  it('renders AlertTriangle icon in fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const ThrowError = () => {
      throw new Error('oops');
    };

    const { container } = render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );
    const alertSvg = container.querySelector('svg.lucide-alert-triangle');
    expect(alertSvg).toBeDefined();

    vi.mocked(console.error).mockRestore();
  });

  it('reload button resets error state and shows children again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    let shouldThrow = true;
    const ConditionalThrower = () => {
      if (shouldThrow) {
        throw new Error('可恢复的错误');
      }
      return <div>已恢复的内容</div>;
    };

    render(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>
    );

    expect(screen.getByText('应用出现了错误')).toBeDefined();

    shouldThrow = false;
    fireEvent.click(screen.getByText('重新加载'));

    expect(screen.getByText('已恢复的内容')).toBeDefined();

    vi.mocked(console.error).mockRestore();
  });

  it('calls console.error with error info', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const testError = new Error('console测试');

    const ThrowError = () => {
      throw testError;
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      'ErrorBoundary caught:',
      testError,
      expect.any(Object)
    );
    consoleSpy.mockRestore();
  });
});
