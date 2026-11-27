/**
 * `/init` gives the system components the product's look (UP-226): the agent, played by the test,
 * maps a role to the product's token and sets the Button's look through the tools, in the turn
 * `/init` started, and the canvas draws the components with them.
 */
import { assert, it } from "@effect/vitest";
import type { SystemComponentFile } from "@ultrapaint/contracts/components";
import { themeSelector } from "@ultrapaint/contracts/themes";
import { designTokenCss } from "@ultrapaint/design-document/tokens";
import { defaultLookOf } from "@ultrapaint/system-components/defaults";
import { type Context, Effect, type Layer, type Scope } from "effect";
import { OpenProject, type ProjectServices } from "./project.ts";
import { ComponentService } from "./services/components.ts";
import { DesignSystemService } from "./services/design-system.ts";
import { EditService } from "./services/edit.ts";
import { EditorTools } from "./services/mcp/route.ts";
import { ThreadSessions } from "./services/threads/thread-session.ts";
import { callTool, ProjectTest } from "./testing/project.ts";
import { ScriptedAgents } from "./testing/scripted-agents.ts";
import { promptThread } from "./testing/threads.ts";

/** One service of the open project, asked one thing. */
const project = <I extends ProjectServices, S, A, E>(
  key: Context.Key<I, S>,
  f: (service: S) => Effect.Effect<A, E>
) => Effect.flatMap(OpenProject, (p) => p.service(key)(f));

/** The Button's file as the Library lists it, if the project has one. */
const buttonEntry = project(ComponentService, (c) =>
  Effect.map(c.list, (list) =>
    list.components.find((e) => e.file === "components/Button.component.json")
  )
);

/** The product's design system, its brand colour standing for the primary role. */
const DESIGN_SYSTEM = {
  colors: [
    {
      name: "Semantic",
      tokens: [
        {
          description:
            "The main action: the product's brand ink (color-brand-ink)",
          name: "color-primary",
          value: "var(--color-brand-ink)",
        },
      ],
    },
    {
      name: "Brand",
      tokens: [
        {
          name: "color-brand-ink",
          value: "#1d4ed8",
          values: { dark: "#93c5fd" },
        },
      ],
    },
  ],
  radius: [],
  shadows: [],
  spacing: { base: "0.25rem" },
  themes: ["light", "dark"],
  typography: { fonts: [], sizes: [], styles: [], weights: [] },
  version: 1,
};

/**
 * The agent's `/init` turn, played: told the roles, it saves the primary as a var() of the
 * product's ink, then sets the Button's height and radius, and ends.
 */
const initTurn = Effect.gen(function* () {
  const threads = yield* ThreadSessions;
  const agents = yield* ScriptedAgents;
  const { id: threadId } = yield* threads.create();
  yield* promptThread({ attachments: [], text: "/init", threadId });
  const turn = yield* (yield* agents.next).nextTurn;
  assert.include(turn.texts.join("\n"), "color-ring (the focus ring)");
  yield* callTool(
    EditorTools,
    "write_design_system",
    { designMd: "## Overview\n\nAcme.\n", designSystem: DESIGN_SYSTEM },
    threadId
  );
  const root = defaultLookOf("Button")?.base.root ?? {};
  const { text } = yield* callTool(
    EditorTools,
    "handoff",
    {
      action: "change",
      change: {
        op: "setStyle",
        place: { state: null, variant: null },
        slot: "root",
        style: { ...root, height: "3rem", radius: "9999px" },
      },
      target: "component:Button",
    },
    threadId
  );
  assert.strictEqual(text, "Changed Button.");
  yield* turn.end();
});

/** A test on a project of its own, its threads' agent played by the test. */
const inProject = <A, E>(
  name: string,
  body: () => Effect.Effect<
    A,
    E,
    Layer.Success<ReturnType<typeof ProjectTest>> | Scope.Scope
  >
) =>
  it.effect(name, () =>
    body().pipe(Effect.provide(ProjectTest()), Effect.scoped)
  );

inProject(
  "an /init turn leaves the role a var() of the product's token, in the dark theme too",
  () =>
    Effect.gen(function* () {
      yield* initTurn;
      const { designSystem } = yield* project(
        DesignSystemService,
        (d) => d.get
      );
      const css = designTokenCss(designSystem);
      const dark = css.slice(css.indexOf(themeSelector("dark")));
      for (const block of [css, dark]) {
        assert.include(block, "--color-primary: var(--color-brand-ink);");
      }
      assert.include(dark, "--color-brand-ink: #93c5fd;");
    })
);

inProject(
  "an /init turn leaves the Button's file read by the Library, at the product's height and radius",
  () =>
    Effect.gen(function* () {
      yield* initTurn;
      const entry = yield* buttonEntry;
      assert.isUndefined(entry?.problem);
      const button = entry?.component as SystemComponentFile | undefined;
      assert.deepStrictEqual(
        [
          button?.base.root?.height,
          button?.base.root?.radius,
          button?.base.root?.fill,
        ],
        ["3rem", "9999px", "$color-primary"]
      );
    })
);

inProject(
  "the look an /init turn set is undone as its own step, the role kept",
  () =>
    Effect.gen(function* () {
      yield* initTurn;
      yield* project(EditService, (e) => e.undo);
      assert.isUndefined(yield* buttonEntry);
      const { designSystem } = yield* project(
        DesignSystemService,
        (d) => d.get
      );
      assert.strictEqual(
        designSystem?.colors[0]?.tokens[0]?.value,
        "var(--color-brand-ink)"
      );
    })
);
