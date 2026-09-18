-- 채널/영상 저장 기능의 기반 스키마.
--
-- 설계 원칙(대화에서 확정된 내용):
--   1. 실제 mp4를 렌더링하지 않는다. "영상"은 JSON 대본(script) + 나레이션 audioUrl +
--      cut 이미지 imageUrl을 저장해두고, 조회할 때마다 Remotion Player로 다시 재생한다.
--   2. PDF 원본은 저장하지 않는다. cut 블록에 쓰인 페이지는 "이미지"로만 저장한다
--      (클라이언트가 pdfjs로 렌더링한 결과를 저장 시점에 Storage로 업로드).
--   3. 생성 결과는 기본적으로 "임시"다. 사용자가 채널에 명시적으로 저장해야 이 테이블에
--      레코드가 생기고, 그때부터 "영구"로 취급한다. Storage 쪽은 tmp/ vs saved/ 접두사로
--      구분할 예정(저장 시 tmp/{requestId}/... 파일들을 saved/{videoId}/...로 복사).
--      tmp/ 밑에 남은 파일들은 추후 정리 크론이 일정 기간 후 삭제한다.

-- 채널: 로그인한 사용자가 주제별(논문별, 강의별 등)로 영상을 묶어두는 폴더.
create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists channels_user_id_idx on public.channels (user_id);

alter table public.channels enable row level security;

create policy "channels_select_own"
  on public.channels for select
  using (auth.uid() = user_id);

create policy "channels_insert_own"
  on public.channels for insert
  with check (auth.uid() = user_id);

create policy "channels_update_own"
  on public.channels for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "channels_delete_own"
  on public.channels for delete
  using (auth.uid() = user_id);

-- 영상: 채널 안에 저장된 쇼츠 한 편. script는 ShortScript(JSON) 그대로 — title/scenes,
-- scene.audioUrl(나레이션), cut.imageUrl(페이지 이미지)까지 전부 들어있는 self-contained JSON.
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  -- RLS에서 channels까지 조인하지 않고도 바로 걸러낼 수 있도록 user_id를 중복 저장한다.
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  script jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists videos_channel_id_idx on public.videos (channel_id);
create index if not exists videos_user_id_idx on public.videos (user_id);

alter table public.videos enable row level security;

create policy "videos_select_own"
  on public.videos for select
  using (auth.uid() = user_id);

-- insert/update 시 channel_id가 실제로 본인 채널인지까지 확인한다(안 그러면 남의 채널 id를
-- 넣고 자기 user_id로 우회 저장하는 게 가능해진다).
create policy "videos_insert_own"
  on public.videos for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.channels c
      where c.id = channel_id and c.user_id = auth.uid()
    )
  );

create policy "videos_update_own"
  on public.videos for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.channels c
      where c.id = channel_id and c.user_id = auth.uid()
    )
  );

create policy "videos_delete_own"
  on public.videos for delete
  using (auth.uid() = user_id);

-- MVP 저장 개수 상한(계정당). Storage 용량이 한정적이라 "영상 개수"로 예측 가능하게 막아둔다.
-- 필요하면 max_videos_per_user 값만 조절하면 된다.
create or replace function public.enforce_video_quota()
returns trigger as $$
declare
  video_count integer;
  max_videos_per_user integer := 5;
begin
  select count(*) into video_count from public.videos where user_id = new.user_id;
  if video_count >= max_videos_per_user then
    raise exception 'video quota exceeded: max % videos per user', max_videos_per_user;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger videos_quota_check
  before insert on public.videos
  for each row execute function public.enforce_video_quota();
