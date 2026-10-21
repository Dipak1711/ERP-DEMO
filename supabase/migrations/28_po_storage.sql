-- 28_po_storage.sql
-- Storage bucket for Purchase Order attachments (PDFs, supplier quotes, specs, drawings).
-- Private bucket with authenticated read/write policies.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'po-attachments',
  'po-attachments',
  false,
  15 * 1024 * 1024,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY po_attachments_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'po-attachments' AND public.is_active_user());

CREATE POLICY po_attachments_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'po-attachments' AND public.is_active_user());

CREATE POLICY po_attachments_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'po-attachments' AND public.is_active_user());
