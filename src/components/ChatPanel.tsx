import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser } from '@/lib/sessionContext';
import { Send, Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * Issue #43: curated emoji palette for the chat composer. A small, opinionated
 * set covers the common reactions investors/founders reach for during pitches
 * (👏 fire, 💯, 🚀, 💰, 🤔, ❤️) without pulling in a multi-MB emoji-picker dep.
 * Grouped only loosely — order is "most likely to be tapped" first.
 */
const EMOJI_PALETTE: string[] = [
  '👏', '🔥', '💯', '🚀', '💰', '🎉',
  '❤️', '👍', '👎', '😂', '😮', '🤔',
  '🙌', '🙏', '✨', '⭐', '💡', '🎯',
  '✅', '❌', '⚡', '📈', '📉', '🦄',
  '😅', '😎', '🤯', '👀', '🥳', '🤝',
];


interface ChatMessage {
  id: string;
  sender_email: string;
  sender_name: string | null;
  sender_role: string;
  message: string;
  created_at: string;
}

const HISTORY_LIMIT = 50;

export default function ChatPanel({ sessionId }: { sessionId: string }) {
  const { user } = useSessionUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Track every id we've rendered so reconnects / dual-sources never double-post
  const seenIdsRef = useRef<Set<string>>(new Set());

  /**
   * Insert an emoji at the current input cursor position (or append if the
   * input hasn't been focused yet). Keeps focus in the input so the user can
   * keep typing — they don't have to re-click after picking.
   */
  const insertEmoji = (emoji: string) => {
    const input = inputRef.current;
    if (!input) {
      setNewMessage(prev => prev + emoji);
      return;
    }
    const start = input.selectionStart ?? newMessage.length;
    const end = input.selectionEnd ?? newMessage.length;
    const next = newMessage.slice(0, start) + emoji + newMessage.slice(end);
    setNewMessage(next);
    // Restore caret after the inserted emoji on the next paint.
    requestAnimationFrame(() => {
      input.focus();
      const pos = start + emoji.length;
      input.setSelectionRange(pos, pos);
    });
  };


  const appendIfNew = (msg: ChatMessage) => {
    if (!msg?.id) return;
    if (seenIdsRef.current.has(msg.id)) return;
    seenIdsRef.current.add(msg.id);
    setMessages(prev => [...prev, msg]);
  };

  useEffect(() => {
    let cancelled = false;
    seenIdsRef.current = new Set();
    setMessages([]);

    // Subscribe FIRST so we don't miss messages between fetch and subscribe.
    const channel = supabase
      .channel(`chat:${sessionId}`)
      .on('broadcast', { event: 'INSERT' }, ({ payload }) => {
        appendIfNew(payload as ChatMessage);
      })
      .subscribe();

    // Then fetch the latest HISTORY_LIMIT messages (newest-first, reversed for display).
    // Reads go through a SECURITY DEFINER RPC that only returns rows if the
    // caller proves they are a participant of this session — the raw
    // chat_messages table is no longer publicly readable.
    (async () => {
      const { data } = await supabase.rpc('get_session_chat_messages', {
        _session_id: sessionId,
        _email: user?.email ?? '',
        _limit: HISTORY_LIMIT,
      });

      if (cancelled || !data) return;
      const ordered = [...data].reverse() as ChatMessage[];
      // Merge with any broadcast-delivered messages that arrived during the fetch.
      const merged: ChatMessage[] = [];
      const seen = new Set<string>();
      for (const m of ordered) {
        if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
      }
      // Append already-received broadcast messages not in history.
      setMessages(prev => {
        for (const m of prev) {
          if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
        }
        seenIdsRef.current = seen;
        return merged;
      });
    })();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !user) return;
    await supabase.from('chat_messages').insert({
      session_id: sessionId,
      sender_email: user.email,
      sender_name: user.displayName,
      sender_role: user.role,
      message: newMessage.trim(),
    });
    setNewMessage('');
  };

  const roleColor = (role: string) => {
    switch (role) {
      case 'facilitator': return 'text-amber-500';
      case 'startup': return 'text-funding';
      case 'investor': return 'text-blue-400';
      default: return 'text-muted-foreground';
    }
  };

  // Commitment messages are written by InvestDialog with a sentinel prefix so
  // we can render them as green social-proof banners inline with the chat.
  // Format (issue #40): `__COMMIT__::<amount>::<startupName>`
  // Format (issue #41): `__COMMIT__::<amount>::<startupName>::<equity|gift>`
  const parseCommitment = (text: string): { amount: number; startup: string; pledgeType: 'equity' | 'gift' } | null => {
    if (!text?.startsWith('__COMMIT__::')) return null;
    const parts = text.split('::');
    if (parts.length < 3) return null;
    const amount = Number(parts[1]);
    if (!Number.isFinite(amount)) return null;
    // The last segment is the pledge type when present; otherwise the rest is
    // the startup name (which may itself contain "::").
    const last = parts[parts.length - 1];
    const hasType = last === 'equity' || last === 'gift';
    const pledgeType: 'equity' | 'gift' = hasType ? (last as 'equity' | 'gift') : 'equity';
    const nameParts = hasType ? parts.slice(2, -1) : parts.slice(2);
    return { amount, startup: nameParts.join('::'), pledgeType };
  };

  return (
    <div className="flex flex-col h-full bg-card border-l border-border">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Live Q&A</h3>
      </div>

      <ScrollArea className="flex-1 px-4 py-2">
        <div className="space-y-3" data-testid="chat-message-list">
          {messages.map((msg) => {
            const commit = parseCommitment(msg.message);
            if (commit) {
              return (
                <div
                  key={msg.id}
                  className="rounded-md border border-emerald-500/60 bg-emerald-950/60 px-3 py-2"
                  data-testid="chat-commitment-message"
                  data-pledge-type={commit.pledgeType}
                >
                  {/* Anonymized: hide sender name/email. Show only role-based
                      label ("An Investor" / "A Community Supporter") so the
                      chat shows social proof without revealing identities. */}
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-emerald-300">
                      {commit.pledgeType === 'gift' ? '🎁' : '💰'}{' '}
                      {commit.pledgeType === 'gift' ? 'A Community Supporter' : 'An Investor'}
                    </span>
                    <span className="text-[10px] text-emerald-200/70">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm text-white mt-0.5">
                    {commit.pledgeType === 'gift' ? 'pledged a gift of' : 'committed'}{' '}
                    <span className="font-bold mono text-emerald-200">
                      ${commit.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (USD)
                    </span>{' '}
                    to <span className="font-semibold">{commit.startup}</span>
                  </p>
                </div>
              );
            }
            return (
              <div key={msg.id} className="group">
                <div className="flex items-baseline gap-2">
                  <span className={`text-xs font-semibold ${roleColor(msg.sender_role)}`}>
                    {msg.sender_name || msg.sender_email}
                    <span className="font-normal text-muted-foreground"> ({msg.sender_role})</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-sm text-foreground/90 mt-0.5">{msg.message}</p>
              </div>
            );
          })}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {user && (
        <div className="p-3 border-t border-border">
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
            className="flex gap-2"
          >
            <Input
              ref={inputRef}
              data-testid="chat-input"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Ask a question..."
              className="flex-1 bg-muted/50 border-border"
            />
            {/* Issue #43: emoji palette button. Popover keeps the picker
                lightweight and self-contained; clicking an emoji inserts at
                the caret and returns focus to the input. */}
            <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="shrink-0"
                  aria-label="Insert emoji"
                  data-testid="chat-emoji-btn"
                >
                  <Smile className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                side="top"
                className="w-64 p-2"
                data-testid="chat-emoji-palette"
              >
                <div className="grid grid-cols-6 gap-1">
                  {EMOJI_PALETTE.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => { insertEmoji(emoji); setEmojiOpen(false); }}
                      className="text-xl leading-none p-1.5 rounded hover:bg-muted focus:bg-muted focus:outline-none"
                      aria-label={`Insert ${emoji}`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button data-testid="chat-send-btn" type="submit" size="icon" variant="default" className="bg-accent text-accent-foreground hover:bg-accent/90 shrink-0">
              <Send className="w-4 h-4" />
            </Button>

          </form>
        </div>
      )}
    </div>
  );
}
