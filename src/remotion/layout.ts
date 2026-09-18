import type { Scene } from '../schema';

export interface PositionedScene {
  scene: Scene;
  from: number;
  durationInFrames: number;
}

export function toFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
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
