import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RuleEditor } from '../RuleEditor';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty' },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'editor.edit': '编辑',
        'editor.preview': '预览',
        'editor.split': '双栏',
        'common:detail.preview': '内容预览',
      };
      if (key === 'editor.title') return `${opts?.format} 编辑器`;
      if (key === 'editor.lines') return `${opts?.count} 行`;
      return map[key] ?? key;
    },
    i18n: { language: 'zh-CN' },
  }),
}));

describe('RuleEditor', () => {
  const baseContent = '# Test Rule\n\nsome content here\n\nthird line';

  it('渲染内容文本', () => {
    render(<RuleEditor content={baseContent} onChange={() => {}} format="md" />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue(baseContent);
  });

  it('显示 format 标签和行数', () => {
    render(<RuleEditor content={baseContent} onChange={() => {}} format="yaml" />);
    expect(screen.getByText('YAML 编辑器')).toBeDefined();
    expect(screen.getByText('5 行')).toBeDefined();
  });

  it('在 readOnly 模式下 textarea 为只读', () => {
    render(
      <RuleEditor content={baseContent} onChange={() => {}} format="md" readOnly />
    );
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('readonly');
  });

  it('切换视图模式：edit → preview → split', () => {
    render(<RuleEditor content={baseContent} onChange={() => {}} format="md" />);

    // 默认 split 模式 — textarea 和 preview 都存在
    expect(screen.getByRole('textbox')).toBeDefined();
    expect(screen.getByText('内容预览')).toBeDefined();

    // 切换到 edit
    fireEvent.click(screen.getByText('编辑'));
    expect(screen.getByRole('textbox')).toBeDefined();
    expect(screen.queryByText('内容预览')).toBeNull();

    // 切换到 preview
    fireEvent.click(screen.getByText('预览'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('内容预览')).toBeDefined();

    // 切换回 split
    fireEvent.click(screen.getByText('双栏'));
    expect(screen.getByRole('textbox')).toBeDefined();
    expect(screen.getByText('内容预览')).toBeDefined();
  });

  it('onChange 在编辑内容时触发', () => {
    const handleChange = vi.fn();
    render(<RuleEditor content="" onChange={handleChange} format="md" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new content' } });
    expect(handleChange).toHaveBeenCalledWith('new content');
  });

  it('显示占位文本', () => {
    render(<RuleEditor content="" onChange={() => {}} format="md" />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('placeholder', 'Write rule content here...');
  });

  it('空内容显示 1 行', () => {
    render(<RuleEditor content="" onChange={() => {}} format="md" />);
    expect(screen.getByText('1 行')).toBeDefined();
  });

  it('MD editor 标签显示', () => {
    render(<RuleEditor content={baseContent} onChange={() => {}} format="md" />);
    expect(screen.getByText('MD 编辑器')).toBeDefined();
  });
});
