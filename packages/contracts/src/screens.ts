import * as S from "effect/Schema";
import { RepoRelativePath } from "./base.ts";

/** A screen is a TSX file inside the designs directory. `id` is its path relative to designsDir. */
export const Screen = S.Struct({
  id: S.String,
  name: S.String,
  flow: S.String,
  file: RepoRelativePath,
});
export type Screen = typeof Screen.Type;

export const ScreenList = S.Struct({ screens: S.Array(Screen) });
export type ScreenList = typeof ScreenList.Type;

export const ViewportPreset = S.Literal("mobile", "tablet", "desktop", "custom");
export type ViewportPreset = typeof ViewportPreset.Type;

export const presetSize: Record<
  Exclude<ViewportPreset, "custom">,
  { width: number; height: number }
> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 834, height: 1194 },
  desktop: { width: 1440, height: 900 },
};

export const FrameLayout = S.Struct({
  x: S.Number,
  y: S.Number,
  width: S.Number,
  height: S.Number,
  preset: ViewportPreset,
});
export type FrameLayout = typeof FrameLayout.Type;

/** Contents of `<flow>/canvas.json`. Keys are screen file names inside the flow directory. */
export const CanvasLayout = S.Struct({
  version: S.Literal(1),
  frames: S.Record({ key: S.String, value: FrameLayout }),
});
export type CanvasLayout = typeof CanvasLayout.Type;

export const emptyCanvasLayout = (): CanvasLayout => ({ version: 1, frames: {} });
