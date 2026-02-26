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

export default function ChatPanel({ sessionId }: { sessionId: string }) {
  const { user } = useSessionUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch existing messages
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
      if (data) setMessages(data as ChatMessage[]);
    };
    fetchMessages();

    // Subscribe to new messages
    const channel = supabase
      .channel(`chat-${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `session_id=eq.${sessionId}`,
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as ChatMessage]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
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
        <div className="space-y-3">
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
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Ask a question..."
              className="flex-1 bg-muted/50 border-border"
            />
            <Button type="submit" size="icon" variant="default" className="bg-accent text-accent-foreground hover:bg-accent/90 shrink-0">
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
