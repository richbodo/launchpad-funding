import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import DemoModeBanner from '@/components/DemoModeBanner';
import { ArrowLeft, Settings } from 'lucide-react';

interface Session {
  id: string;
  name: string;
  status: string;
  start_time: string;
}

interface Participant {
  email: string;
  display_name: string | null;
  role: string;
  password_hash: string | null;
  session_id: string;
}

export default function DemoLogins() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const { data: sessData } = await supabase
        .from('sessions')
        .select('id, name, status, start_time')
        .like('name', '[DEMO]%')
        .order('start_time', { ascending: true });

      if (sessData && sessData.length > 0) {
        setSessions(sessData);
        const ids = sessData.map(s => s.id);
        const { data: partData } = await supabase
          .from('session_participants')
          .select('email, display_name, role, password_hash, session_id')
          .in('session_id', ids)
          .order('role', { ascending: true });
        if (partData) setParticipants(partData);
      }
      setLoading(false);
    };
    fetchData();
  }, []);

  // Facilitators appear in every session — dedupe and show at top
  const facilitators = participants.filter(p => p.role === 'facilitator');
  const uniqueFacilitators = Array.from(
    new Map(facilitators.map(f => [f.email, f])).values()
  );

  const statusColor = (s: string) =>
    s === 'live' ? 'bg-accent/10 text-accent' :
    s === 'scheduled' ? 'bg-primary/10 text-primary' :
    'bg-muted text-muted-foreground';

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <DemoModeBanner />
        <div className="flex items-center justify-center py-20 text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <DemoModeBanner />
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate('/login')}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Session Login
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
            <Settings className="w-4 h-4 mr-1" /> Admin
          </Button>
        </div>

        <h1 className="text-2xl font-bold mb-2">Demo Login Credentials</h1>
        <p className="text-muted-foreground mb-6">
          Facilitators manage sessions and administer the application. Startups and investors don't need passwords — just enter the email and select the role.
        </p>

        {/* Facilitators */}
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Facilitators (all sessions)</CardTitle>
            <p className="text-xs text-muted-foreground">Facilitators have full admin access — session management, participant setup, and live session controls. Use these credentials for both the session login and the admin dashboard.</p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Password</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uniqueFacilitators.map(f => (
                  <TableRow key={f.email}>
                    <TableCell className="font-medium">{f.display_name || f.email}</TableCell>
                    <TableCell className="font-mono text-sm">{f.email}</TableCell>
                    <TableCell className="font-mono text-sm">{f.password_hash || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Per-session participants */}
        {sessions.map(session => {
          const sessionParticipants = participants.filter(
            p => p.session_id === session.id && p.role !== 'facilitator'
          );
          const startups = sessionParticipants.filter(p => p.role === 'startup');
          const investors = sessionParticipants.filter(p => p.role === 'investor');

          return (
            <Card key={session.id} className="mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {session.name}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(session.status)}`}>
                    {session.status}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {startups.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Startups</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Password</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {startups.map(p => (
                          <TableRow key={p.email}>
                            <TableCell className="font-medium">{p.display_name || p.email}</TableCell>
                            <TableCell className="font-mono text-sm">{p.email}</TableCell>
                            <TableCell className="font-mono text-sm">—</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {investors.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Investors</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Password</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {investors.map(p => (
                          <TableRow key={p.email}>
                            <TableCell className="font-medium">{p.display_name || p.email}</TableCell>
                            <TableCell className="font-mono text-sm">{p.email}</TableCell>
                            <TableCell className="font-mono text-sm">—</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
