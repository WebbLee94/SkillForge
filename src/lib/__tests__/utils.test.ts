import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { cn, sanitizePath, formatDate } from '../utils';

describe('cn', () => {
  it('merges class names with twMerge', () => {
    expect(cn('px-4', 'py-2')).toBe('px-4 py-2');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
  });

  it('handles clsx array syntax', () => {
    expect(cn(['a', 'b'], 'c')).toBe('a b c');
  });

  it('resolves tailwindMerge conflicts (later wins)', () => {
    // twMerge should resolve px-4 vs px-2 → px-2 wins
    expect(cn('px-4', 'px-2')).toBe('px-2');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });
});

describe('sanitizePath', () => {
  it('replaces /Users/username prefix with ~', () => {
    expect(sanitizePath('/Users/john/projects/skill')).toBe('~/projects/skill');
  });

  it('returns empty string unchanged', () => {
    expect(sanitizePath('')).toBe('');
  });

  it('returns path without /Users/ prefix unchanged', () => {
    expect(sanitizePath('/etc/config')).toBe('/etc/config');
  });

  it('handles nested /Users/ path with multiple segments', () => {
    expect(sanitizePath('/Users/admin/Documents/work/file.txt')).toBe(
      '~/Documents/work/file.txt'
    );
  });

  it('handles just /Users/username alone', () => {
    expect(sanitizePath('/Users/me')).toBe('~');
  });
});

describe('formatDate', () => {
  beforeAll(() => {
    // Pin "now" for deterministic tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('returns 刚刚 for < 1 minute', () => {
    const date = new Date('2026-08-03T11:59:45Z').toISOString();
    expect(formatDate(date)).toBe('刚刚');
  });

  it('returns X 分钟前 for < 60 minutes', () => {
    const date = new Date('2026-08-03T11:30:00Z').toISOString();
    expect(formatDate(date)).toBe('30 分钟前');
  });

  it('returns X 小时前 for < 24 hours', () => {
    const date = new Date('2026-08-03T06:00:00Z').toISOString();
    expect(formatDate(date)).toBe('6 小时前');
  });

  it('returns X 天前 for < 7 days', () => {
    const date = new Date('2026-08-01T12:00:00Z').toISOString();
    expect(formatDate(date)).toBe('2 天前');
  });

  it('returns formatted date for >= 7 days', () => {
    // 10 days ago
    const date = new Date('2026-07-24T12:00:00Z').toISOString();
    const result = formatDate(date);
    // Should be a localized date string like '2026/07/24' or '2026-07-24'
    expect(result).toMatch(/2026/);
  });

  it('handles edge case: exactly 1 minute', () => {
    const date = new Date('2026-08-03T11:59:00Z').toISOString();
    expect(formatDate(date)).toBe('1 分钟前');
  });

  it('handles edge case: exactly 1 hour', () => {
    const date = new Date('2026-08-03T11:00:00Z').toISOString();
    expect(formatDate(date)).toBe('1 小时前');
  });
});
