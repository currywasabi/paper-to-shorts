-- cut 페이지 이미지를 저장하는 공개 버킷. narration-audio와 달리 브라우저(사용자 세션)에서
-- 직접 업로드한다 — pdfjs로 이미 렌더링해둔 이미지를 그대로 올리는 거라 서버를 거칠 필요가 없다.
-- 경로 규칙: {user_id}/{video_id}/page-{n}.png. 정책은 그 user_id 폴더 밑으로만 쓰기를 제한한다.
insert into storage.buckets (id, name, public)
values ('cut-images', 'cut-images', true)
on conflict (id) do nothing;

create policy "cut_images_select_public"
  on storage.objects for select
  using (bucket_id = 'cut-images');

create policy "cut_images_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'cut-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "cut_images_update_own"
  on storage.objects for update
  using (
    bucket_id = 'cut-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "cut_images_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'cut-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
