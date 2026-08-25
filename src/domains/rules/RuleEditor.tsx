import { Suspense, lazy, memo, useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

const RulePreviewPanel = lazy(
  () => import('../../components/RulePreviewPanel.lazy')
);

type ViewMode = 'edit' | 'preview' | 'split';

interface RuleEditorProps {
  content: string;
  onChange: (content: string) => void;
  format: 'mdc' | 'md' | 'yaml';
  readOnly?: boolean;
  defaultViewMode?: ViewMode;
}

export const RuleEditor = memo(function RuleEditor({
  content,
  onChange,
  format,
  readOnly = false,
  defaultViewMode = 'split',
}: RuleEditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(defaultViewMode);
  const [previewContent, setPreviewContent] = useState(content);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced preview update (300ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreviewContent(content);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content]);

  const lineCount = content.split('\n').length;

  const { t } = useTranslation(['rules', 'common']);

  const viewModes: { key: ViewMode; label: string }[] = [
    { key: 'edit', label: t('editor.edit') },
    { key: 'preview', label: t('editor.preview') },
    { key: 'split', label: t('editor.split') },
  ];

  return (
    <div className="flex h-full flex-col rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1.5">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {t('editor.title', { format: format.toUpperCase() })}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('editor.lines', { count: lineCount })}
          </span>
        </div>
        <div className="flex items-center gap-0.5 rounded-md bg-background p-0.5">
          {viewModes.map((mode) => (
            <button
              key={mode.key}
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                viewMode === mode.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setViewMode(mode.key)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Editor pane */}
        {viewMode !== 'preview' && (
          <div
            className={cn(
              'flex flex-col',
              viewMode === 'split' ? 'w-1/2 border-r border-border' : 'w-full'
            )}
          >
            <textarea
              value={content}
              onChange={(e) => onChange(e.target.value)}
              readOnly={readOnly}
              className={cn(
                'flex-1 resize-none bg-card p-3 font-mono text-sm text-foreground',
                'placeholder:text-muted-foreground focus:outline-none',
                readOnly && 'cursor-default opacity-80'
              )}
              placeholder="Write rule content here..."
              spellCheck={false}
            />
          </div>
        )}

        {/* Preview pane */}
        {viewMode !== 'edit' && (
          <div
            className={cn(
              'flex flex-col overflow-hidden',
              viewMode === 'split' ? 'w-1/2' : 'w-full'
            )}
          >
            <div className="shrink-0 border-b border-border bg-muted/30 px-3 py-1">
              <span className="text-xs text-muted-foreground">
                {t('common:detail.preview')}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto bg-background">
              <Suspense fallback={null}>
                <RulePreviewPanel content={previewContent} format={format} />
              </Suspense>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
