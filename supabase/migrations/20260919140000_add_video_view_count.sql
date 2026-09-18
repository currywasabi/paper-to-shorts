-- 갤러리 정렬(조회수순)에 쓸 조회수 컬럼. 업로드 날짜는 기존 created_at을 그대로 쓴다.
alter table public.videos
  add column if not exists view_count integer not null default 0;

-- 클라이언트가 view_count를 직접 update하게 두면 동시 재생 시 read-then-write로 값이
-- 씹힐 수 있어서, DB에서 원자적으로 +1 하는 함수를 통해서만 늘리게 한다.
-- security definer라 RLS를 우회하지만, 함수 안에서 user_id = auth.uid()로 본인 영상만 허용한다.
create or replace function public.increment_video_view(video_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.videos
  set view_count = view_count + 1
  where id = video_id and user_id = auth.uid();
$$;

grant execute on function public.increment_video_view(uuid) to authenticated;
