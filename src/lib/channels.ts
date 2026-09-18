import { getSupabaseClient } from './supabaseClient';
import { shortScriptSchema, type ShortScript } from '../schema';

export interface Channel {
  id: string;
  name: string;
  createdAt: string;
}

export interface VideoSummary {
  id: string;
  channelId: string;
  title: string;
  createdAt: string;
  thumbnailUrl: string | null;
}

/** 갤러리 카드 썸네일 = 대본에서 처음 등장하는 cut 블록의 저장된 페이지 이미지. */
function firstCutImageUrl(script: ShortScript): string | null {
  for (const scene of script.scenes) {
    for (const block of scene.blocks) {
      if (block.type === 'cut' && block.imageUrl) return block.imageUrl;
    }
  }
  return null;
}

export async function listChannels(): Promise<Channel[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('channels')
    .select('id, name, created_at')
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
  }));
}

export async function createChannel(name: string): Promise<Channel> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');

  const { data, error } = await supabase
    .from('channels')
    .insert({ name, user_id: user.id })
    .select('id, name, created_at')
    .single();

  if (error) throw new Error(error.message);

  return { id: data.id as string, name: data.name as string, createdAt: data.created_at as string };
}

export async function renameChannel(id: string, name: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('channels').update({ name }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** videos가 channel_id에 on delete cascade로 걸려 있어 해당 채널의 영상도 함께 삭제된다. */
export async function deleteChannel(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('channels').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** channelId가 null이면 "전체" — 로그인한 사용자의 모든 채널을 합친 영상 목록. */
export async function listVideos(channelId: string | null): Promise<VideoSummary[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from('videos')
    .select('id, channel_id, title, script, created_at')
    .order('created_at', { ascending: false });

  if (channelId) query = query.eq('channel_id', channelId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const parsed = shortScriptSchema.safeParse(row.script);
    return {
      id: row.id as string,
      channelId: row.channel_id as string,
      title: row.title as string,
      createdAt: row.created_at as string,
      thumbnailUrl: parsed.success ? firstCutImageUrl(parsed.data) : null,
    };
  });
}
