import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface Props {
  children: string;
  className?: string;
}

/**
 * Render a small subset of Markdown safely for user-authored copy
 * (event descriptions, etc.). Bullets, bold/italic, and links are supported;
 * raw HTML is stripped by react-markdown's default skipHtml behavior.
 *
 * Links always open in a new tab with rel="noopener noreferrer".
 */
export default function MarkdownView({ children, className }: Props) {
  if (!children) return null;
  return (
    <div
      className={cn(
        // Minimal prose styling that inherits the surrounding color so it
        // works on both light cards and dark hero backgrounds.
        'space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1',
        '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1',
        '[&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:opacity-80',
        '[&_strong]:font-semibold [&_em]:italic',
        '[&_p]:leading-relaxed',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
