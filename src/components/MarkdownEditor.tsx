import { useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Bold, List, Link as LinkIcon } from 'lucide-react';

interface Props {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}

/**
 * Lightweight Markdown editor used for event descriptions.
 *
 * Provides a tiny toolbar (Bold / Bullet list / Link) that wraps or prefixes
 * the current selection in the underlying <textarea>. The textarea behaves
 * like a normal multi-line input — Enter just inserts a newline; nothing in
 * here triggers form submission or auto-save.
 */
export default function MarkdownEditor({
  id, value, onChange, rows = 6, placeholder,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  /** Replace the current selection (or insert at caret) and restore focus. */
  const applyEdit = (
    transform: (selected: string, before: string, after: string) => {
      next: string; selectionStart: number; selectionEnd: number;
    },
  ) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const selected = value.slice(start, end);
    const after = value.slice(end);
    const { next, selectionStart, selectionEnd } = transform(selected, before, after);
    onChange(next);
    // Defer caret restoration until React rerenders with the new value.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selectionStart, selectionEnd);
    });
  };

  const wrapBold = () => applyEdit((sel, before, after) => {
    const text = sel || 'bold text';
    const inserted = `**${text}**`;
    const next = before + inserted + after;
    const caret = before.length + 2;
    return { next, selectionStart: caret, selectionEnd: caret + text.length };
  });

  const insertBullets = () => applyEdit((sel, before, after) => {
    // Ensure we start on a fresh line so the bullet renders correctly.
    const needsLeadingNL = before.length > 0 && !before.endsWith('\n');
    const lead = needsLeadingNL ? '\n' : '';
    const body = sel
      ? sel.split('\n').map((l) => (l.trim() ? `- ${l.replace(/^[-*]\s*/, '')}` : l)).join('\n')
      : '- ';
    const inserted = lead + body;
    const next = before + inserted + after;
    const caret = before.length + inserted.length;
    return { next, selectionStart: caret, selectionEnd: caret };
  });

  const insertLink = () => applyEdit((sel, before, after) => {
    const text = sel || 'link text';
    const url = 'https://';
    const inserted = `[${text}](${url})`;
    const next = before + inserted + after;
    // Select the URL placeholder so the admin can paste over it immediately.
    const urlStart = before.length + text.length + 3;
    return { next, selectionStart: urlStart, selectionEnd: urlStart + url.length };
  });

  const ToolbarBtn = (props: {
    onClick: () => void; label: string; children: React.ReactNode;
  }) => (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 px-2"
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
    >
      {props.children}
    </Button>
  );

  return (
    <div className="rounded-md border border-input bg-background">
      <div className="flex items-center gap-1 border-b border-input px-1 py-1">
        <ToolbarBtn onClick={wrapBold} label="Bold">
          <Bold className="w-3.5 h-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={insertBullets} label="Bulleted list">
          <List className="w-3.5 h-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={insertLink} label="Link">
          <LinkIcon className="w-3.5 h-3.5" />
        </ToolbarBtn>
        <span className="ml-auto text-[10px] text-muted-foreground pr-2">
          Markdown: **bold**, - bullet, [text](url)
        </span>
      </div>
      <Textarea
        id={id}
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-t-none"
      />
    </div>
  );
}
