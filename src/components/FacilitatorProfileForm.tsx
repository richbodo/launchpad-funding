/**
 * FacilitatorProfileForm
 * ----------------------
 * Inline facilitator profile editor used by the Green Room
 * (`/session/:id/ready`). Mirrors the in-session `FacilitatorEditDialog` but
 * adds an image upload (profile photo) and lives outside any dialog.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import ImageUploadField from '@/components/ImageUploadField';
import { useSessionUser } from '@/lib/sessionContext';

export interface FacilitatorProfileSnapshot {
  bio: string | null;
  image_url: string | null;
}

interface Props {
  sessionId: string;
  email: string;
  onSaved?: (snapshot: FacilitatorProfileSnapshot) => void;
}

export default function FacilitatorProfileForm({ sessionId, email, onSaved }: Props) {
  const { user } = useSessionUser();
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    supabase
      .from('session_participants')
      .select('id, bio, image_url')
      .eq('session_id', sessionId)
      .eq('email', email)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setParticipantId(data.id);
        setBio((data as any).bio || '');
        setImageUrl((data as any).image_url || '');
      });
  }, [sessionId, email]);

  const handleSave = async () => {
    if (!participantId) {
      toast.error('Could not identify facilitator row');
      return;
    }
    if (bio.length > 500) {
      toast.error('Bio must be 500 characters or fewer.');
      return;
    }
    setSaving(true);
    const updates = {
      bio: bio.trim() || null,
      image_url: imageUrl || null,
    };
    const { data, error } = await supabase.functions.invoke('facilitator-update-self', {
      body: { participant_token: user?.token || '', ...updates },
    });
    setSaving(false);
    if (error || (data as any)?.error) {
      toast.error('Failed to save profile');
      return;
    }
    toast.success('Profile saved');
    onSaved?.(updates);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="gr-facilitator-bio">
          Bio <span className="ml-1 text-xs text-muted-foreground">(optional, up to 500 characters)</span>
        </Label>
        <textarea
          id="gr-facilitator-bio"
          rows={6}
          maxLength={500}
          placeholder="A short bio shown on the public event page."
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 500))}
          className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="text-right text-xs text-muted-foreground">{bio.length}/500</div>
      </div>
      {participantId && (
        <ImageUploadField
          label="Profile photo"
          value={imageUrl}
          onChange={setImageUrl}
          kind="participant"
          refId={participantId}
          participantToken={user?.token || null}
          helpText="Shown to attendees on the event page and in the session. PNG/JPG/WebP/GIF, max 5MB."
        />
      )}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving} data-testid="save-facilitator-profile-btn">
          {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
          Save profile
        </Button>
      </div>
    </div>
  );
}
