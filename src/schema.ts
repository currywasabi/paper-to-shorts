import { z } from 'zod';

// 장면 안에서 독립적인 시작 시점(startOffset)과 길이(duration)를 갖는 요소들의 공통 타이밍.
const timedElement = {
  startOffset: z.number().min(0),
  duration: z.number().min(0.1),
};

/** 배경 화면 — 지금 단계는 PDF 페이지 번호만(페이지 전체 렌더링), 정교한 크롭은 나중 단계. */
export const cutSchema = z.object({
  page: z.number().int().min(1),
  ...timedElement,
});

/** 테이프 붙이듯 화면에 쾅 등장하는 강조 문구(공식/정의 한 줄 등). */
export const attachmentSchema = z.object({
  text: z.string(),
  // 등장 효과음 이름 — 실제 오디오 에셋이 아직 없어서 자리만 예약(재생 로직 없음).
  sound: z.string().optional(),
  ...timedElement,
});

/** 펑 터지는 효과, 밈 움짤 등 나중에 수동으로 채워 넣을 에셋 자리. 지금은 렌더링하지 않는다. */
export const effectSchema = z.object({
  name: z.string(),
  ...timedElement,
});

export const sceneSchema = z.object({
  // TTS로 읽을 나레이션. PDF 내용을 그대로 옮기지 말고 결론/반전, 설명, 임팩트, 펀치라인 등으로 각색.
  text: z.string(),
  duration: z.number().min(1.5).max(15),
  cut: cutSchema.optional(),
  attachment: attachmentSchema.optional(),
  effect: effectSchema.optional(),
});

export const shortScriptSchema = z.object({
  // 영상 상단에 고정으로 표시되는 제목(볼드체).
  title: z.string(),
  scenes: z.array(sceneSchema).min(1),
});

export type Cut = z.infer<typeof cutSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type ShortScript = z.infer<typeof shortScriptSchema>;
