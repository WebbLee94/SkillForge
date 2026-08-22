import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RulePreviewPanel } from '../../RulePreviewPanel';

describe('RulePreviewPanel', () => {
  it('shows empty state when content is empty string', () => {
    render(<RulePreviewPanel content="" format="yaml" />);
    expect(screen.getByText('暂无内容')).toBeDefined();
  });

  it('shows empty state when content is only spaces', () => {
    render(<RulePreviewPanel content="   " format="yaml" />);
    expect(screen.getByText('暂无内容')).toBeDefined();
  });

  it('renders markdown content when format is md', () => {
    render(<RulePreviewPanel content="# Hello\nThis is **bold** text." format="md" />);
    return waitFor(() => {
      expect(screen.getByText('Hello', { exact: false })).toBeDefined();
      expect(screen.getByText('bold')).toBeDefined();
    });
  });

  it('renders markdown content when format is mdc', () => {
    render(<RulePreviewPanel content="## Section\nSome content" format="mdc" />);
    return waitFor(() => {
      expect(screen.getByText('Section', { exact: false })).toBeDefined();
      expect(screen.getByText('Some content', { exact: false })).toBeDefined();
    });
  });

  it('renders YAML key-value pairs when format is not md/mdc', () => {
    const yamlContent = 'name: test-rule\ndescription: A test rule\nseverity: warning';
    render(<RulePreviewPanel content={yamlContent} format="yaml" />);
    expect(screen.getByText('name:')).toBeDefined();
    expect(screen.getByText('test-rule')).toBeDefined();
    expect(screen.getByText('description:')).toBeDefined();
    expect(screen.getByText('A test rule')).toBeDefined();
    expect(screen.getByText('severity:')).toBeDefined();
    expect(screen.getByText('warning')).toBeDefined();
  });

  it('strips surrounding quotes from YAML values', () => {
    const yamlContent = 'name: "quoted name"\nlevel: \'single quoted\'';
    render(<RulePreviewPanel content={yamlContent} format="yaml" />);
    expect(screen.getByText('quoted name')).toBeDefined();
    expect(screen.getByText('single quoted')).toBeDefined();
  });

  it('ignores comment lines in YAML', () => {
    const yamlContent = '# This is a comment\nname: real-value\n# another comment';
    render(<RulePreviewPanel content={yamlContent} format="yaml" />);
    expect(screen.getByText('name:')).toBeDefined();
    expect(screen.getByText('real-value')).toBeDefined();
    const keySpans = document.querySelectorAll('[class*="font-mono text-primary"]');
    expect(keySpans.length).toBe(1);
  });

  it('skips rendering value when YAML value is empty', () => {
    const yamlContent = 'key-without-value:\nnext-key: has-value';
    render(<RulePreviewPanel content={yamlContent} format="yaml" />);
    expect(screen.getByText('key-without-value:')).toBeDefined();
    expect(screen.getByText('has-value')).toBeDefined();
    expect(screen.getByText('next-key:')).toBeDefined();
  });

  it('renders indented YAML with correct padding', () => {
    const yamlContent = 'top: value\n  nested: inner\n    deep: deepest';
    render(<RulePreviewPanel content={yamlContent} format="yaml" />);
    expect(screen.getByText('top:')).toBeDefined();
    expect(screen.getByText('value')).toBeDefined();
    expect(screen.getByText('nested:')).toBeDefined();
    expect(screen.getByText('inner')).toBeDefined();
    expect(screen.getByText('deep:')).toBeDefined();
    expect(screen.getByText('deepest')).toBeDefined();
  });

  it('renders GFM markdown (tables, links)', () => {
    const mdContent = '| A | B |\n|---|---|\n| 1 | 2 |\n\n[link](https://example.com)';
    render(<RulePreviewPanel content={mdContent} format="md" />);
    return waitFor(() => {
      expect(screen.getByText('A', { exact: false })).toBeDefined();
      expect(screen.getByText('B', { exact: false })).toBeDefined();
      expect(screen.getByText('link')).toBeDefined();
    });
  });

  it('handles format with no key-value matches', () => {
    const content = 'this is not yaml at all\njust some text\nwithout colons';
    render(<RulePreviewPanel content={content} format="yaml" />);
    const keys = document.querySelectorAll('[class*="font-mono text-primary"]');
    expect(keys.length).toBe(0);
  });
});
