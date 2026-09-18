import { FunctionsHttpError } from '@supabase/supabase-js';

import { getSupabaseClient } from './supabaseClient';
import { shortScriptSchema, type ShortScript } from '../schema';

// Gemini 분석 + 씬별 Typecast TTS 합성(동시 2개 제한)까지 한 요청 안에서 순차적으로 처리하므로
// 씬이 많을수록 오래 걸린다 — 기존 90초로는 부족해서 넉넉하게 잡는다.
const REQUEST_TIMEOUT_MS = 240_000;

// 서버(supabase/functions/summarize-script/index.ts)가 붙여 보내는 source 태그를 사람이 읽을 라벨로.
const UPSTREAM_SOURCE_LABEL: Record<string, string> = {
  gemini: 'Gemini',
  typecast: 'Typecast',
  storage: 'Storage',
};

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

async function describeError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      console.warn('[summarize-script] 실패 응답', body);
      if (typeof body?.error === 'string') {
        const label = typeof body?.source === 'string' ? UPSTREAM_SOURCE_LABEL[body.source] : undefined;
        return label ? `[${label}] ${body.error}` : body.error;
      }
    } catch {
      // 응답 본문이 JSON이 아니면 기본 메시지로 폴백
    }
  }
  if (error instanceof Error) return error.message;
  return '대본 생성 요청이 실패했습니다.';
}

/** PDF 파일 전체를 Gemini Files API로 보내 쇼츠용 장면(scene) 대본을 받아온다.
 * Gemini의 responseSchema는 startOffset+duration<=scene.duration 같은 필드 간 제약까지는
 * 강제할 수 없으므로, 받은 JSON을 여기서 다시 zod로 검증해 스키마를 깨는 응답을 걸러낸다. */
export async function summarizeScript(file: File): Promise<ShortScript> {
  const pdfBase64 = await fileToBase64(file);
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.functions.invoke<unknown>('summarize-script', {
    body: { pdfBase64 },
    timeout: REQUEST_TIMEOUT_MS,
  });

  if (error || !data) throw new Error(await describeError(error));

  const result = shortScriptSchema.safeParse(data);
  if (!result.success) {
    console.warn('[summarize-script] 응답이 스키마와 맞지 않음', result.error.issues);
    throw new Error('생성된 대본이 예상한 형식과 맞지 않습니다.');
  }

  return result.data;
}
