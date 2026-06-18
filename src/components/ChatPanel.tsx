import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSessionUser } from '@/lib/sessionContext';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

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
  const scrollRef = useRef<HTMLDivElement>(null);
  // Track every id we've rendered so reconnects / dual-sources never double-post
  const seenIdsRef = useRef<Set<string>>(new Set());

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
    (async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('id, sender_email, sender_name, sender_role, message, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT);
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

  return (
    <div className="flex flex-col h-full bg-card border-l border-border">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Live Q&A</h3>
      </div>

      <ScrollArea className="flex-1 px-4 py-2">
        <div className="space-y-3" data-testid="chat-message-list">
          {messages.map((msg) => (
            <div key={msg.id} className="group">
              <div className="flex items-baseline gap-2">
                <span className={`text-xs font-semibold ${roleColor(msg.sender_role)}`}>
                  {msg.sender_name || msg.sender_email}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-sm text-foreground/90 mt-0.5">{msg.message}</p>
            </div>
          ))}
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
              data-testid="chat-input"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Ask a question..."
              className="flex-1 bg-muted/50 border-border"
            />
            <Button data-testid="chat-send-btn" type="submit" size="icon" variant="default" className="bg-accent text-accent-foreground hover:bg-accent/90 shrink-0">
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
