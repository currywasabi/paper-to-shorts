import { getSupabaseClient } from './supabaseClient';
import type { CutBlock, ShortScript } from '../schema';

const CUT_IMAGES_BUCKET = 'cut-images';

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = /data:(.*?);base64/.exec(header)?.[1] ?? 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** script가 참조하는 cut 페이지 이미지를 Storage에 올리고, 각 cut 블록에 imageUrl을 채워 돌려준다.
 * pageImages에 없는 페이지(렌더링 실패 등)는 imageUrl 없이 그대로 둔다. */
async function attachCutImageUrls(
  userId: string,
  videoId: string,
  script: ShortScript,
  pageImages: Record<number, string>,
): Promise<ShortScript> {
  const supabase = getSupabaseClient();

  const pages = new Set<number>();
  for (const scene of script.scenes) {
    for (const block of scene.blocks) {
      if (block.type === 'cut') pages.add(block.page);
    }
  }

  const uploadedUrls = new Map<number, string>();
  for (const page of pages) {
    const dataUrl = pageImages[page];
    if (!dataUrl) continue;

    const path = `${userId}/${videoId}/page-${page}.png`;
    const { error } = await supabase.storage
      .from(CUT_IMAGES_BUCKET)
      .upload(path, dataUrlToBlob(dataUrl), { contentType: 'image/png', upsert: true });
    if (error) throw new Error(`이미지 업로드 실패 (p.${page}): ${error.message}`);

    const { data } = supabase.storage.from(CUT_IMAGES_BUCKET).getPublicUrl(path);
    uploadedUrls.set(page, data.publicUrl);
  }

  return {
    ...script,
    scenes: script.scenes.map((scene) => ({
      ...scene,
      blocks: scene.blocks.map((block): typeof block => {
        if (block.type !== 'cut') return block;
        const imageUrl = uploadedUrls.get(block.page);
        return imageUrl ? ({ ...block, imageUrl } satisfies CutBlock) : block;
      }),
    })),
  };
}

export interface SaveVideoParams {
  channelId: string;
  script: ShortScript;
  // cut.page -> pdfjs로 렌더링해둔 data URL. AddVideoModal의 미리보기 캐시를 그대로 넘겨받는다.
  pageImages: Record<number, string>;
}

/** 미리보기 중인 생성 결과를 실제로 채널에 영구 저장한다 — cut 이미지 업로드 + videos row insert. */
export async function saveVideo({ channelId, script, pageImages }: SaveVideoParams): Promise<void> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');

  const videoId = crypto.randomUUID();
  const scriptWithImages = await attachCutImageUrls(user.id, videoId, script, pageImages);

  const { error } = await supabase.from('videos').insert({
    id: videoId,
    channel_id: channelId,
    user_id: user.id,
    title: script.title,
    script: scriptWithImages,
  });

  if (error) {
    if (error.message.includes('video quota exceeded')) {
      throw new Error('저장 가능한 영상 개수(최대 5개)를 초과했습니다. 기존 영상을 정리한 뒤 다시 시도해주세요.');
    }
    throw new Error(error.message);
  }
}
