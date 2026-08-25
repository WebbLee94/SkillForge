import { Suspense, lazy, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const RuleMarkdownRenderer = lazy(
  () => import('./RuleMarkdownRenderer.lazy')
);

interface RulePreviewPanelProps {
  content: string;
  format: string;
}

/** Parse simple YAML into key-value pairs (best-effort, no full YAML parser) */
function parseYamlPairs(
  text: string
): Array<{ key: string; value: string; indent: number }> {
  const lines = text.split('\n');
  const pairs: Array<{ key: string; value: string; indent: number }> = [];
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(\s*)([\w.-]+)\s*:\s*(.*)$/);
    if (match) {
      const indent = match[1].length;
      const key = match[2];
      let value = match[3].trim();
      // Remove surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      pairs.push({ key, value, indent });
    }
  }
  return pairs;
}

export const RulePreviewPanel = memo(function RulePreviewPanel({
  content,
  format,
}: RulePreviewPanelProps) {
  const { t } = useTranslation('rules');
  const isMarkdown = format === 'md' || format === 'mdc';

  const yamlPairs = useMemo(() => {
    if (isMarkdown) return [];
    return parseYamlPairs(content);
  }, [content, isMarkdown]);

  if (!content.trim()) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('previewEmpty')}
      </div>
    );
  }

  if (isMarkdown) {
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none h-full overflow-y-auto p-4">
        <Suspense fallback={null}>
          <RuleMarkdownRenderer content={content} />
        </Suspense>
      </div>
    );
  }

  // YAML key-value tree
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="space-y-1">
        {yamlPairs.map((pair, idx) => (
          <div
            key={idx}
            className="flex items-baseline gap-2 text-sm"
            style={{ paddingLeft: `${pair.indent * 12}px` }}
          >
            <span className="shrink-0 font-mono text-primary">{pair.key}:</span>
            {pair.value && (
              <span className="font-mono text-foreground break-all">
                {pair.value}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
