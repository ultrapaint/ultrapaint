/**
 * `measure`: the checks no wording made a reviewer see (g02, g08), measured on a rendered page
 * instead of looked for in a picture: the spacing between groups and the dividers' centres, and
 * with `checks` the general design checks (ADR 0061). The checks themselves are
 * `@ultrapaint/design-checks`; this opens the page, runs them and prints what they found.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  dividerFindings,
  hoverFindings,
  spacingFindings,
} from "@ultrapaint/design-checks/findings";
import { Console, Effect } from "effect";
import { axeFindings } from "./axe.ts";
import { Browser } from "./browser.ts";
import { EvalsError } from "./errors.ts";
import { writeJson } from "./layout.ts";

export interface MeasureOptions {
  /**
   * The general design checks too (contrast, control edges and fills, surface tones, touching
   * rows, clipped text, names that can't truncate, targets, controls shown only on hover); none
   * without it.
   */
  readonly checks?:
    | {
        /** Whether axe-core measures contrast and target sizes too. */
        readonly axe?: boolean;
        /** The spacing scale's step for the computed-spacing check; 0 leaves it out. */
        readonly grid: number;
        /** Whether the page is checked again with every control drawn as hovered. */
        readonly hover: boolean;
        readonly nearTone: number;
        readonly stress: boolean;
      }
    | undefined;
  /** Where the findings go as JSON, besides the terminal. */
  readonly out: string | undefined;
  /** How many times the gap inside a group the gap between groups must be: the core's 2. */
  readonly ratio: number;
  /** What to measure: a CSS selector, the whole page by default. */
  readonly root: string;
  /** A module of steps to run first, `export default [async (page) => {}]`, as the capture scripts. */
  readonly steps: string | undefined;
  readonly theme: "dark" | "light";
}

export const measure = Effect.fn("measure")(function* (
  url: string,
  options: MeasureOptions
) {
  const browser = yield* Browser;
  const steps = options.steps
    ? yield* Effect.tryPromise({
        catch: (cause) =>
          new EvalsError({
            message: `cannot load the steps ${options.steps}: ${String(cause)}`,
          }),
        try: () =>
          import(pathToFileURL(path.resolve(options.steps ?? "")).href),
      }).pipe(
        Effect.map((module: { readonly default?: unknown }) => module.default)
      )
    : undefined;
  const layout = yield* browser.layout(url, {
    root: options.root,
    steps: Array.isArray(steps) ? steps : [],
    theme: options.theme,
  });
  const spacing = layout.block
    ? spacingFindings(layout.block, options.ratio)
    : [];
  const dividers = dividerFindings(layout.rules);
  for (const f of spacing) {
    yield* Console.log(
      `groups: ${f.between}px between “${f.above}” and “${f.below}”, ${f.within}px between the lines below: under ${options.ratio}×`
    );
  }
  for (const f of dividers) {
    yield* Console.log(`divider: ${f.off}px off its bar's line, in “${f.bar}”`);
  }
  const audited = options.checks
    ? yield* browser.audit(url, {
        ...options.checks,
        hoverChecks: ["touching-rows", "control-fill"],
        root: options.root,
        steps: Array.isArray(steps) ? steps : [],
        theme: options.theme,
      })
    : undefined;
  const checked = audited ? hoverFindings(audited) : [];
  const fromAxe = axeFindings(audited?.axe ?? []);
  for (const f of fromAxe) {
    yield* Console.log(
      `axe ${f.rule}${f.certain ? "" : " (to confirm)"}: ${f.detail}, ${f.label}`
    );
  }
  for (const f of checked) {
    yield* Console.log(
      `${f.check}${f.on === "hover" ? " (on hover)" : ""}: ${f.detail}, “${f.label}”`
    );
  }
  yield* Console.log(
    `${spacing.length} spacing and ${dividers.length} divider findings; ${layout.rules.length} dividers measured${options.checks ? `; ${checked.length} from the checks` : ""}${options.checks?.axe ? `; ${fromAxe.length} from axe` : ""}`
  );
  if (options.out) {
    yield* writeJson(options.out, {
      ...(options.checks?.axe && { axe: fromAxe }),
      checks: checked,
      dividers,
      spacing,
      theme: options.theme,
      url,
    });
  }
});
