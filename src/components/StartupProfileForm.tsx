/**
 * StartupProfileForm
 * ------------------
 * Inline startup profile editor used by the Green Room (`/session/:id/ready`).
 *
 * Same fields and same edge function (`startup-update-self`) as
 * `StartupEditDialog` in Session.tsx — extracted into a standalone, non-dialog
 * component so it can be embedded directly in the Green Room page. The two
 * forms intentionally remain duplicated for now (rather than the dialog
 * wrapping this component) to avoid touching the in-session edit flow during
 * this refactor.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import ImageUploadField from '@/components/ImageUploadField';
import { useSessionUser } from '@/lib/sessionContext';

export interface StartupProfileSnapshot {
  description: string | null;
  funding_goal: number | null;
  dd_room_link: string | null;
  website_link: string | null;
  image_url: string | null;
}

interface Props {
  sessionId: string;
  email: string;
  /** Called with the saved values after a successful round-trip. */
  onSaved?: (snapshot: StartupProfileSnapshot) => void;
}

const normalizeUrl = (raw: string): string | null => {
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
};

export default function StartupProfileForm({ sessionId, email, onSaved }: Props) {
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [fundingGoal, setFundingGoal] = useState('');
  const [ddRoomLink, setDdRoomLink] = useState('');
  const [websiteLink, setWebsiteLink] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    supabase
      .from('session_participants')
      .select('id, funding_goal, dd_room_link, website_link, description, image_url')
      .eq('session_id', sessionId)
      .eq('email', email)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setParticipantId(data.id);
        setFundingGoal(data.funding_goal != null ? String(data.funding_goal) : '');
        setDdRoomLink(data.dd_room_link || '');
        setWebsiteLink(data.website_link || '');
        setDescription((data as any).description || '');
        setImageUrl((data as any).image_url || '');
      });
  }, [sessionId, email]);

  const handleSave = async () => {
    if (!participantId) {
      toast.error('Could not identify startup row');
      return;
    }
    if (!description.trim()) {
      toast.error('Please add a short description (about two sentences).');
      return;
    }
    setSaving(true);
    const updates = {
      funding_goal: fundingGoal ? parseFloat(fundingGoal) : null,
      dd_room_link: normalizeUrl(ddRoomLink),
      website_link: normalizeUrl(websiteLink),
      description: description.trim(),
      image_url: imageUrl || null,
    };
    const { data, error } = await supabase.functions.invoke('startup-update-self', {
      body: { participant_id: participantId, ...updates },
    });
    setSaving(false);
    const errMsg = error?.message || (typeof data?.error === 'string' ? data.error : null) ||
      (data?.error && typeof data.error === 'object' ? JSON.stringify(data.error) : null);
    if (errMsg) {
      toast.error(`Failed to save: ${errMsg}`);
      return;
    }
    toast.success('Startup info saved');
    onSaved?.(updates);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="gr-startup-description">
          Description <span className="text-destructive">*</span>
          <span className="ml-1 text-xs text-muted-foreground">(about two sentences)</span>
        </Label>
        <textarea
          id="gr-startup-description"
          required
          rows={3}
          maxLength={600}
          placeholder="One or two sentences describing what your startup does."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="gr-funding-goal">Funding Goal ($)</Label>
        <Input
          id="gr-funding-goal"
          type="number"
          placeholder="125000"
          value={fundingGoal}
          onChange={(e) => setFundingGoal(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="gr-dd-room-link">DD Room Link</Label>
        <Input
          id="gr-dd-room-link"
          type="url"
          placeholder="https://..."
          value={ddRoomLink}
          onChange={(e) => setDdRoomLink(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="gr-website-link">Website</Label>
        <Input
          id="gr-website-link"
          type="url"
          placeholder="https://..."
          value={websiteLink}
          onChange={(e) => setWebsiteLink(e.target.value)}
        />
      </div>
      {participantId && (
        <ImageUploadField
          label="Logo / Image"
          value={imageUrl}
          onChange={setImageUrl}
          kind="participant"
          refId={participantId}
          participantId={participantId}
          helpText="Shown to investors when you join. PNG/JPG/WebP/GIF, max 5MB."
        />
      )}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving} data-testid="save-startup-profile-btn">
          {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
          Save profile
        </Button>
      </div>
    </div>
  );
}
