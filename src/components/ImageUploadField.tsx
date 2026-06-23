import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, X, Loader2, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { getAdminToken } from '@/lib/adminAuth';

interface Props {
  label: string;
  /** Current public URL (or empty string). */
  value: string;
  onChange: (url: string) => void;
  /** Which upload bucket folder to use. */
  kind: 'session-hero' | 'participant';
  /** session.id for hero, participant.id for participant uploads. */
  refId: string;
  helpText?: string;
  /**
   * When set, authenticates as the participant (startup self-upload) instead
   * of as an admin/facilitator. Server enforces that participant_id matches
   * ref_id and that the participant has role='startup'.
   */
  participantId?: string;
}

/**
 * Issue #44: Image upload field for admin UIs.
 *
 * Renders a preview thumbnail, a hidden <input type="file">, an Upload
 * button, a Clear button, and a fallback URL text input for paste-in. The
 * file picker streams the chosen file as base64 to the `upload-event-image`
 * edge function, which writes to the public `event-images` bucket as a
 * facilitator (admin_token-authorized) and returns the public URL.
 */
export default function ImageUploadField({
  label, value, onChange, kind, refId, helpText, participantId,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const handlePick = () => inputRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking same file
    if (!file) return;

    // Validate file type (client-side; server re-validates).
    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!ALLOWED.includes(file.type)) {
      const pretty = file.type || 'unknown';
      toast.error(
        `Unsupported image type (${pretty}). Please upload a JPG, PNG, WebP, or GIF.`
      );
      return;
    }

    // Validate file size (5MB max).
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      const mb = (file.size / (1024 * 1024)).toFixed(1);
      toast.error(`Image is ${mb}MB. Maximum size is 5MB — please choose a smaller file.`);
      return;
    }
    if (file.size === 0) {
      toast.error('That file is empty. Please choose a different image.');
      return;
    }

    if (!refId) {
      toast.error('Save the record first, then upload an image.');
      return;
    }
    setUploading(true);
    try {
      const file_base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const { data, error } = await supabase.functions.invoke('upload-event-image', {
        body: {
          // Either admin (facilitator) auth OR participant self-upload auth.
          ...(participantId ? { participant_id: participantId } : { admin_token: getAdminToken() }),
          file_base64,
          content_type: file.type,
          kind,
          ref_id: refId,
          filename: file.name,
        },
      });
      if (error || (data as any)?.error) {
        toast.error(`Upload failed: ${(data as any)?.error || error?.message}`);
        return;
      }
      onChange((data as any).url);
      toast.success('Image uploaded');
    } catch (err: any) {
      toast.error(`Upload failed: ${err?.message || 'unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <Label className="text-xs flex items-center gap-1">
        <ImageIcon className="w-3.5 h-3.5" /> {label}
      </Label>
      <div className="mt-1 flex items-start gap-3">
        <div className="w-20 h-20 rounded-md border border-border bg-muted/30 overflow-hidden flex items-center justify-center shrink-0">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="w-full h-full object-cover" />
          ) : (
            <ImageIcon className="w-6 h-6 text-muted-foreground/50" />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleFile}
            />
            <Button type="button" size="sm" variant="outline" onClick={handlePick} disabled={uploading}>
              {uploading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
              {uploading ? 'Uploading…' : value ? 'Replace' : 'Upload'}
            </Button>
            {value && (
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange('')} disabled={uploading}>
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="…or paste a public image URL"
            className="text-xs font-mono"
          />
          {helpText && <p className="text-[11px] text-muted-foreground">{helpText}</p>}
        </div>
      </div>
    </div>
  );
}
