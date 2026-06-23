DROP POLICY IF EXISTS "Public read event-images" ON storage.objects;

CREATE POLICY "Public can view event image files"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'event-images'
  AND name IS NOT NULL
  AND name <> ''
);