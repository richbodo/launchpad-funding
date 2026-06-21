CREATE POLICY "Public read event-images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'event-images');