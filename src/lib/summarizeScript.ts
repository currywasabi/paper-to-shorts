import { FunctionsHttpError } from '@supabase/supabase-js';

import { getSupabaseClient } from './supabaseClient';

export interface Scene {
  caption: string;
  narration: string;
  durationHint: number;
  // 편집 효과(줌, 강조 등)를 나중에 붙이기 위한 자리. 지금은 채워지지 않는다.
  effect?: string;
}

export interface SummarizeResult {
  scenes: Scene[];
}

const REQUEST_TIMEOUT_MS = 90_000;

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
      if (typeof body?.error === 'string') return body.error;
    } catch {
      // 응답 본문이 JSON이 아니면 기본 메시지로 폴백
    }
  }
  if (error instanceof Error) return error.message;
  return '대본 생성 요청이 실패했습니다.';
}

/** PDF 파일 전체를 Gemini Files API로 보내 쇼츠용 장면(scene) 대본을 받아온다. */
export async function summarizeScript(file: File): Promise<SummarizeResult> {
  const pdfBase64 = await fileToBase64(file);
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.functions.invoke<SummarizeResult>('summarize-script', {
    body: { pdfBase64 },
    timeout: REQUEST_TIMEOUT_MS,
  });

  if (error || !data) throw new Error(await describeError(error));
  return data;
}
