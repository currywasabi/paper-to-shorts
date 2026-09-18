import { z } from 'zod';

// 블록마다 독립적인 시작 시점(startOffset)과 길이(duration)를 갖는다. 한 scene 안에서
// 여러 블록이 자유롭게 겹치거나 순서대로 나열될 수 있다(레고 블럭처럼 조합).
const timedElement = {
  startOffset: z.number().min(0),
  duration: z.number().min(0.1),
};

// public/assets/sounds 에 실제로 있는 효과음 파일 이름(확장자 제외).
export const SOUND_NAMES = ['adrian', 'brain', 'discord', 'faaah', 'fbi', 'pew', 'siu', 'wow'] as const;

// public/assets/images 에 실제로 있는 밈 이미지 파일 이름.
export const MEME_IMAGE_NAMES = [
  'cryingpepe.jpg',
  'dancingpepe1.gif',
  'dancingpepe2.gif',
  'sadpepe.jpg',
  'smilepepe.webp',
] as const;

/** 배경 화면 — 지금 단계는 PDF 페이지 번호만(페이지 전체 렌더링), 정교한 크롭은 나중 단계. */
export const cutBlockSchema = z.object({
  type: z.literal('cut'),
  page: z.number().int().min(1),
  ...timedElement,
});

/** 테이프 붙이듯 화면에 쾅 등장하는 강조 문구(공식/정의 한 줄 등). */
export const attachmentBlockSchema = z.object({
  type: z.literal('attachment'),
  text: z.string(),
  ...timedElement,
});

/** public/assets/images의 밈 이미지를 화면 구석(주로 하단)에 붙이는 장식. */
export const memeBlockSchema = z.object({
  type: z.literal('meme'),
  image: z.enum(MEME_IMAGE_NAMES),
  ...timedElement,
});

/** public/assets/sounds의 효과음. attachment 등 다른 블록에 종속되지 않는 독립 블록 —
 * 1~2초짜리 클립이라 duration을 짧게 제한하고, 볼륨도 너무 크지 않게 상한을 둔다. */
export const soundBlockSchema = z.object({
  type: z.literal('sound'),
  name: z.enum(SOUND_NAMES),
  startOffset: z.number().min(0),
  duration: z.number().min(0.5).max(2),
  volume: z.number().min(0).max(0.6).default(0.35),
});

/** 펑 터지는 효과 등 나중에 수동으로 채워 넣을 에셋 자리. 지금은 렌더링하지 않는다. */
export const effectBlockSchema = z.object({
  type: z.literal('effect'),
  name: z.string(),
  ...timedElement,
});

/** scene을 구성하는 레고 블럭 하나. type으로 구분되며 한 scene에 몇 개든, 어떤 조합이든 넣을 수 있다. */
export const blockSchema = z.discriminatedUnion('type', [
  cutBlockSchema,
  attachmentBlockSchema,
  memeBlockSchema,
  soundBlockSchema,
  effectBlockSchema,
]);

export const sceneSchema = z
  .object({
    // TTS로 읽을 나레이션. PDF 내용을 그대로 옮기지 말고 결론/반전, 설명, 임팩트, 펀치라인 등으로 각색.
    text: z.string(),
    // Gemini가 처음엔 추정치로 채우지만, TTS 합성 후 실제 음성 길이로 서버에서 덮어쓴다.
    // 그래서 저작 시점 추정치보다 범위를 넉넉하게 둔다(진짜 이상치만 걸러내는 용도).
    duration: z.number().min(0.5).max(20),
    // cut/attachment/meme/sound/effect를 자유 조합. 순서·개수·중첩 제약 없음.
    blocks: z.array(blockSchema).default([]),
    // TTS로 합성된 나레이션 오디오 URL. 서버가 채워준다 — 수동 작성 스크립트는 없어도 된다.
    audioUrl: z.string().optional(),
  })
  // 프롬프트에서도 같은 규칙을 요구하지만, Gemini 응답이 그 규칙을 어겨도 통과되지 않도록 여기서 한 번 더 막는다.
  .refine((scene) => scene.blocks.every((block) => block.startOffset + block.duration <= scene.duration), {
    message: 'blocks의 startOffset + duration은 scene.duration을 넘을 수 없습니다.',
    path: ['blocks'],
  });

export const shortScriptSchema = z.object({
  // 영상 상단에 고정으로 표시되는 제목(볼드체).
  title: z.string(),
  scenes: z.array(sceneSchema).min(1),
});

export type CutBlock = z.infer<typeof cutBlockSchema>;
export type AttachmentBlock = z.infer<typeof attachmentBlockSchema>;
export type MemeBlock = z.infer<typeof memeBlockSchema>;
export type SoundBlock = z.infer<typeof soundBlockSchema>;
export type EffectBlock = z.infer<typeof effectBlockSchema>;
export type Block = z.infer<typeof blockSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type ShortScript = z.infer<typeof shortScriptSchema>;
