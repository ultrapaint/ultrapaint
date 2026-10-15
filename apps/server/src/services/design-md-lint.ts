import type { DesignFinding } from "@ultrapaint/contracts/design-system";
import { parse } from "@ultrapaint/design-md/parse";
import { lint } from "@google/design.md/linter";
import { Context, Effect, Layer } from "effect";

/**
 * What the format's own linter (`@google/design.md`, ADR 0027) says about a DESIGN.md: broken
 * references, contrast of component pairs, section order, tokens it cannot type. What the
 * file's reading finds (a section twice, YAML that does not read) comes first, as errors: the
 * linter does not report a section given twice, which the format calls an error.
 */
export class DesignMdLint extends Context.Service<
  DesignMdLint,
  {
    readonly lint: (text: string) => Effect.Effect<readonly DesignFinding[]>;
  }
>()("ultrapaint/server/DesignMdLint") {
  static readonly layer = Layer.succeed(
    DesignMdLint,
    DesignMdLint.of({
      lint: Effect.fn("DesignMdLint.lint")(function* (text: string) {
        const read: DesignFinding[] = parse(text).problems.map((message) => ({
          message,
          severity: "error",
        }));
        const found = yield* Effect.try(() => lint(text).findings).pipe(
          Effect.map((findings) =>
            findings.map(
              (f): DesignFinding => ({
                message: f.message,
                ...(f.path !== undefined && { path: f.path }),
                severity: f.severity,
              })
            )
          ),
          // The linter gives up on a file it cannot read at all; the reading says why.
          Effect.orElseSucceed((): DesignFinding[] => [])
        );
        return [...read, ...found];
      }),
    })
  );
}
