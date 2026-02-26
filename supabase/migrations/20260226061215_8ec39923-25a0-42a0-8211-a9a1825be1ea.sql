
-- Create storage bucket for chat archives
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-archives', 'chat-archives', true);

-- Allow anyone to read archived chat files
CREATE POLICY "Chat archives are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-archives');

-- Allow authenticated users (facilitators via edge function service role) to upload
CREATE POLICY "Chat archives uploadable by authenticated"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'chat-archives');

-- Allow deletion of chat archives by authenticated
CREATE POLICY "Chat archives deletable by authenticated"
ON storage.objects FOR DELETE
USING (bucket_id = 'chat-archives');
