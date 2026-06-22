import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Globe, Copy, Check, X, UserCheck, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { getAdminToken } from '@/lib/adminAuth';
import ImageUploadField from '@/components/ImageUploadField';

interface SessionLike {
  id: string;
  name: string;
  slug?: string | null;
  hero_image_url?: string | null;
  description?: string | null;
  max_attendees?: number | null;
  is_full?: boolean | null;
}
interface ParticipantLike {
  id: string;
  email: string;
  role: string;
  display_name: string | null;
  approved?: boolean | null;
  investor_class?: 'accredited' | 'community' | null;
}

interface Props {
  session: SessionLike;
  participants: ParticipantLike[];
  onUpdated: (updated: any) => void;
  onApproveParticipant: (p: ParticipantLike) => Promise<void>;
  onRejectParticipant: (p: ParticipantLike) => Promise<void>;
  /** Re-fetch participants from the DB (used by the Refresh button so the
   *  admin can pull in newly-arrived self-signups without re-logging in). */
  onRefresh: () => Promise<void> | void;
}

/**
 * Issue #44: Admin controls for the public event landing page.
 *
 * - Edit slug, description, hero image URL, max attendees, and the "Mark
 *   session full" toggle. All writes go through admin-action update_session
 *   (slug normalization is enforced server-side).
 * - Shows the public /event/:slug URL with a copy-to-clipboard button.
 * - Lists pending self-signups (role='investor' AND approved=false) with
 *   Approve / Remove actions. Approve only flips the flag; the admin then
 *   uses the existing "Send invitation" button in the Participants list to
 *   actually email the magic-link login.
 */
export default function EventLandingAdminCard({
  session, participants, onUpdated, onApproveParticipant, onRejectParticipant,
}: Props) {
  const [slug, setSlug] = useState(session.slug || '');
  const [description, setDescription] = useState(session.description || '');
  const [heroUrl, setHeroUrl] = useState(session.hero_image_url || '');
  const [maxAttendees, setMaxAttendees] = useState(String(session.max_attendees ?? 100));
  const [isFull, setIsFull] = useState(!!session.is_full);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSlug(session.slug || '');
    setDescription(session.description || '');
    setHeroUrl(session.hero_image_url || '');
    setMaxAttendees(String(session.max_attendees ?? 100));
    setIsFull(!!session.is_full);
  }, [session.id, session.slug, session.description, session.hero_image_url, session.max_attendees, session.is_full]);

  const landingUrl = session.slug
    ? `${window.location.origin}/event/${session.slug}`
    : '';

  const pendingSignups = participants.filter(p => p.role === 'investor' && p.approved === false);
  const approvedInvestors = participants.filter(p => p.role === 'investor' && p.approved !== false);

  const save = async () => {
    setSaving(true);
    const max = Number(maxAttendees);
    const { data, error } = await supabase.functions.invoke('admin-action', {
      body: {
        admin_token: getAdminToken(),
        action: 'update_session',
        payload: {
          id: session.id,
          slug: slug.trim() || null,
          description: description.trim() || null,
          hero_image_url: heroUrl.trim() || null,
          max_attendees: Number.isFinite(max) && max > 0 ? Math.min(max, 1000) : 100,
          is_full: isFull,
        },
      },
    });
    setSaving(false);
    if (error || (data as any)?.error) {
      toast.error(`Failed to save: ${(data as any)?.error || error?.message}`);
      return;
    }
    toast.success('Landing page updated');
    if ((data as any)?.session) onUpdated((data as any).session);
  };

  const copyUrl = () => {
    if (!landingUrl) return;
    navigator.clipboard.writeText(landingUrl);
    toast.success('Landing page URL copied');
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="w-5 h-5" /> Event Landing Page
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Public URL preview */}
        <div>
          <Label className="text-xs">Public URL</Label>
          <div className="flex items-center gap-2 mt-1">
            <Input
              readOnly
              value={landingUrl || '(set a slug below to generate the URL)'}
              className="font-mono text-xs"
            />
            <Button size="sm" variant="outline" onClick={copyUrl} disabled={!landingUrl}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="landing-slug" className="text-xs">URL slug</Label>
            <Input
              id="landing-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="spring-demo-2026"
              className="mt-1 font-mono"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Letters, numbers, hyphens. Becomes /event/&lt;slug&gt;.
            </p>
          </div>
          <div>
            <Label htmlFor="landing-max" className="text-xs">Max attendees (hard cap 1000)</Label>
            <Input
              id="landing-max"
              type="number"
              min={1}
              max={1000}
              value={maxAttendees}
              onChange={(e) => setMaxAttendees(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>

        <ImageUploadField
          label="Hero image (optional)"
          value={heroUrl}
          onChange={setHeroUrl}
          kind="session-hero"
          refId={session.id}
          helpText="Shown at the top of /event/<slug>. Recommended 1600×600, max 5MB."
        />

        <div>
          <Label htmlFor="landing-desc" className="text-xs">Event description (optional)</Label>
          <Textarea
            id="landing-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1"
            placeholder="One short paragraph describing the event…"
          />
        </div>

        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <div className="text-sm font-medium">Mark session full</div>
            <p className="text-xs text-muted-foreground">
              Turns off signups even before the cap is reached. Visitors see “Sorry, the session is full.”
            </p>
          </div>
          <Switch checked={isFull} onCheckedChange={setIsFull} />
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving} className="bg-accent text-accent-foreground hover:bg-accent/90">
            {saving ? 'Saving…' : 'Save landing page'}
          </Button>
        </div>

        {/* Pending self-signups */}
        <div className="border-t border-border pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <UserCheck className="w-4 h-4" /> Pending signups
              {pendingSignups.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  ({pendingSignups.length})
                </span>
              )}
            </h4>
            <span className="text-xs text-muted-foreground">
              {approvedInvestors.length} / {session.max_attendees ?? 100} approved
            </span>
          </div>
          {pendingSignups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending signups.</p>
          ) : (
            <ul className="divide-y divide-border">
              {pendingSignups.map((p) => (
                <li key={p.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm truncate">{p.display_name || p.email}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {p.email}
                      {p.investor_class ? ` · ${p.investor_class}` : ''}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => onApproveParticipant(p)}>
                      <Check className="w-4 h-4 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onRejectParticipant(p)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
