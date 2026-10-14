-- 15 · Storage for die pictures (top / bottom image of each die).
-- The app used to keep down-scaled base64 data URLs in localStorage; now the file lives in this private
-- bucket and dies.top_img_path / bottom_img_path hold the object path, e.g. 'FGD-0002/top-1760000000.jpg'.
-- Show images with supabase.storage.from('die-images').createSignedUrl(path, 3600).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('die-images', 'die-images', false, 5 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy die_images_read   on storage.objects for select to authenticated
  using (bucket_id = 'die-images' and public.is_active_user());
create policy die_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'die-images' and public.is_active_user());
create policy die_images_update on storage.objects for update to authenticated
  using (bucket_id = 'die-images' and public.is_active_user());
-- no delete policy: images are kept for traceability, like everything else in Die Management
