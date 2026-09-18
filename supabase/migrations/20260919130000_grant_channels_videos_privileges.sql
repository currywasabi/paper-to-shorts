-- 20260918190430 마이그레이션은 RLS 정책만 만들고 테이블 자체 권한(GRANT)은 열지 않았다.
-- RLS는 "권한이 있는 요청 중 어떤 행을 볼 수 있는지"를 거르는 것이지, 접근 권한 자체를
-- 주는 게 아니라서 authenticated 롤에 GRANT가 없으면 정책과 무관하게
-- "permission denied for table ..." 로 막힌다. 실제 행 단위 제어는 기존 RLS 정책이 그대로 담당한다.
grant usage on schema public to authenticated;

grant select, insert, update, delete on public.channels to authenticated;
grant select, insert, update, delete on public.videos to authenticated;
