import type { Scene } from '../schema';

export interface PositionedScene {
  scene: Scene;
  from: number;
  durationInFrames: number;
}

export function toFrames(seconds: number, fps: number): number {
  // 내림으로 반올림되면 오디오가 있는 Sequence가 실제 길이보다 짧아져서 끝이 잘릴 수 있다 —
  // 그래서 round가 아니라 ceil로 항상 여유 있게 잡는다.
  return Math.max(1, Math.ceil(seconds * fps));
}

export function totalDurationInFrames(scenes: Scene[], fps: number): number {
  return scenes.reduce((sum, s) => sum + toFrames(s.duration, fps), 0) || fps;
}

export function layoutScenes(scenes: Scene[], fps: number): PositionedScene[] {
  return scenes.reduce<PositionedScene[]>((acc, scene) => {
    const previous = acc[acc.length - 1];
    const from = previous ? previous.from + previous.durationInFrames : 0;
    return [...acc, { scene, from, durationInFrames: toFrames(scene.duration, fps) }];
  }, []);
}
