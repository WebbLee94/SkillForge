import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface RuleMarkdownRendererProps {
  readonly content: string;
}

export function RuleMarkdownRenderer({ content }: RuleMarkdownRendererProps) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
}
