import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import DemoModeBanner from '@/components/DemoModeBanner';
import { ArrowLeft, Settings } from 'lucide-react';

const demoCredentials = [
  { section: 'Facilitators', entries: [
    { email: 'facilitator@demo.com', password: 'demo123', name: 'Demo Facilitator', role: 'facilitator' },
    { email: 'admin@demo.com', password: 'demo123', name: 'Demo Admin', role: 'facilitator' },
  ]},
  { section: 'Startups (Demo Day Alpha)', entries: [
    { email: 'acme@demo.com', password: '—', name: 'AcmeTech', role: 'startup' },
    { email: 'nova@demo.com', password: '—', name: 'NovaPay', role: 'startup' },
    { email: 'green@demo.com', password: '—', name: 'GreenGrid', role: 'startup' },
  ]},
  { section: 'Investors (Demo Day Alpha)', entries: [
    { email: 'alice@investor.com', password: '—', name: 'Alice Chen', role: 'investor' },
    { email: 'bob@investor.com', password: '—', name: 'Bob Martinez', role: 'investor' },
    { email: 'carol@investor.com', password: '—', name: 'Carol Nguyen', role: 'investor' },
    { email: 'dave@investor.com', password: '—', name: 'Dave Wilson', role: 'investor' },
  ]},
];

export default function DemoLogins() {
  const navigate = useNavigate();

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

        <h1 className="text-2xl font-bold mb-6">Demo Login Credentials</h1>
        <p className="text-muted-foreground mb-6">
          Use any of these accounts to test the platform. Startups and investors don't need passwords — just enter the email and select the role.
        </p>

        {demoCredentials.map(group => (
          <Card key={group.section} className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{group.section}</CardTitle>
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
                  {group.entries.map(e => (
                    <TableRow key={e.email}>
                      <TableCell className="font-medium">{e.name}</TableCell>
                      <TableCell className="font-mono text-sm">{e.email}</TableCell>
                      <TableCell className="font-mono text-sm">{e.password}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
