/**
 * Track A, `extract`: a design system made from pictures. An agent is given the screens of one
 * product (a family of references) in a copy of a host that has a library (the starter's), and
 * is asked, as a user would ask, to make the project's tokens and components match them; the
 * design system is then brought into Ultrapaint with `/sync`, and a second agent lays every
 * component out on a sheet (`/components`). Each component is cut from the sheet, to be
 * compared, best of several runs, with the same component cut from the product's screens.
 *
 * A run's copy of the host is kept (`host/`): the best one becomes the family's library for
 * track B (`freeze`), where screens are composed from it.
 */
import path from "node:path";
import { Effect, FileSystem, Predicate, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Browser } from "./browser.ts";

import { EvalsConfig } from "./config.ts";
import { EvalsError } from "./errors.ts";
import { commitOf, traceOf } from "./generate.ts";
import {
  listDir,
  prompt,
  readJson,
  readPageFile,
  writeJson,
  writeText,
} from "./layout.ts";
import { Models } from "./models.ts";
import { familyOf, loadReferences } from "./reference.ts";
import { slugOf } from "./sections.ts";
import { launch, rpc, runPrompt, type UltrapaintSession } from "./session.ts";

/** Every family's design system is made of these, each in the states that show its style. */
export const COMPONENTS: readonly {
  readonly name: string;
  readonly states: string;
}[] = [
  {
    name: "Button",
    states:
      "primary, secondary and tertiary (text only), one with a leading icon, one destructive",
  },
  {
    name: "Input",
    states:
      "empty with its placeholder, filled, with a leading icon, with an error",
  },
  { name: "Select", states: "closed, showing a chosen value" },
  { name: "Checkbox", states: "unchecked and checked, each with its label" },
  { name: "Switch", states: "off and on, each with its label" },
  {
    name: "Badge",
    states: "neutral, success, warning and error, one with a dot",
  },
  {
    name: "Avatar",
    states: "with a photo, with initials, and a group of overlapping avatars",
  },
  {
    name: "Tabs",
    states: "a segmented control and a row of underlined tabs, one selected",
  },
  {
    name: "Card",
    states: "a card with a title, a line of text and an action",
  },
  {
    name: "Table",
    states:
      "a header row and three rows: a checkbox, a person, a status badge and an amount",
  },
  {
    name: "Navigation item",
    states: "a sidebar's items: one default, one active, one with a count",
  },
  {
    name: "Dialog",
    states: "a title, a line of text, and cancel and confirm buttons",
  },
];

const componentList = COMPONENTS.map((c) => `- ${c.name}: ${c.states}`).join(
  "\n"
);

/** The background kept around a component cut from the sheet, in pixels of its picture. */
const CROP_MARGIN = 12;

/** The host every extraction starts from: a project with a library to restyle. */
const BASE_HOST = "starter";
export const COMPONENTS_FILE = "components.json";
export const COMPONENTS_DIR = "components";

const Box = Schema.Struct({
  height: Schema.Number,
  width: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
});
const FamilyComponent = Schema.Struct({
  box: Box,
  /**
   * What the product's own version of the component is, when another one fills its place (a
   * dropdown menu where a select was asked for, a workspace switcher); absent in older finds.
   */
  kind: Schema.optional(Schema.String),
  missing: Schema.Boolean,
  name: Schema.String,
  picture: Schema.String,
});
const FamilyComponents = Schema.Struct({
  components: Schema.Array(FamilyComponent),
});

export const ExtractInfo = Schema.Struct({
  agent: Schema.String,
  commit: Schema.String,
  family: Schema.String,
  model: Schema.optional(Schema.String),
  name: Schema.String,
  runs: Schema.Number,
  startedAt: Schema.String,
  track: Schema.Literal("extract"),
});

/** A host copied for one run, its packages linked rather than copied. */
const copyHost = Effect.fn("copyHost")(function* (from: string, to: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(to, { force: true, recursive: true });
  yield* fs.makeDirectory(to, { recursive: true });
  for (const entry of yield* fs.readDirectory(from)) {
    if (entry === ".eval-designs" || entry === "node_modules") {
      continue;
    }
    if (entry !== "app") {
      yield* fs.copy(path.join(from, entry), path.join(to, entry));
      continue;
    }
    yield* fs.makeDirectory(path.join(to, "app"));
    for (const inner of yield* fs.readDirectory(path.join(from, "app"))) {
      if (inner !== "node_modules") {
        yield* fs.copy(
          path.join(from, "app", inner),
          path.join(to, "app", inner)
        );
      }
    }
  }
  // Its own packages, installed from the store: a link to another project's would be outside
  // the agent's sandbox, and broken for it.
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* spawner
    .string(
      ChildProcess.make(
        "pnpm",
        [
          "install",
          "--frozen-lockfile",
          "--prefer-offline",
          "--ignore-scripts",
        ],
        { cwd: path.join(to, "app") }
      )
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new EvalsError({
            message: `installing the host's packages: ${cause}`,
          })
      )
    );
});

const PICTURE = /\.(jpg|png|webp)$/;
const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** The family's screens, as a user would attach them: each reference's whole picture. */
const familyPictures = Effect.fn("familyPictures")(function* (family: string) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const references = (yield* loadReferences([])).filter(
    (r) => familyOf(r) === family
  );
  const pictures: { readonly dataUrl: string; readonly name: string }[] = [];
  for (const reference of references) {
    const file = path.join(data.captureDir(reference.id), "desktop-fold.jpg");
    if (yield* fs.exists(file)) {
      const bytes = yield* fs.readFile(file);
      pictures.push({
        dataUrl: `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`,
        name: `${reference.id}.jpg`,
      });
    }
  }
  return { pictures, references };
});

/** Around a component cut from a screen, this share of its own size of the screen on each side. */
const COMPONENT_SURROUNDINGS = 0.25;

/**
 * Each component cut from the screen it was found in, with some of the screen around it, so it is
 * seen where it lives (on its surface, beside its neighbours) when compared with an agent's.
 */
/** The family's component crops (`families/<family>/components`), as pictures to attach. */
const componentPictures = Effect.fn("componentPictures")(function* (
  family: string
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const dir = path.join(data.familyDir(family), COMPONENTS_DIR);
  if (!(yield* fs.exists(dir))) {
    return [];
  }
  const pictures: { readonly dataUrl: string; readonly name: string }[] = [];
  for (const file of (yield* fs.readDirectory(dir))
    .filter((f) => f.endsWith(".jpg"))
    .sort()) {
    const bytes = yield* fs.readFile(path.join(dir, file));
    pictures.push({
      dataUrl: `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`,
      name: `component-${file}`,
    });
  }
  return pictures;
});

export const cutFamilyComponents = Effect.fn("cutFamilyComponents")(function* (
  family: string,
  found: typeof FamilyComponents.Type
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const browser = yield* Browser;
  const dir = data.familyDir(family);
  yield* fs.makeDirectory(path.join(dir, COMPONENTS_DIR), { recursive: true });
  for (const c of found.components) {
    const picture = path.join(data.references, c.picture);
    if (c.missing || !(yield* fs.exists(picture))) {
      continue;
    }
    const around = (size: number) => size * COMPONENT_SURROUNDINGS;
    const box = {
      height: c.box.height + 2 * around(c.box.height),
      width: c.box.width + 2 * around(c.box.width),
      x: c.box.x - around(c.box.width),
      y: c.box.y - around(c.box.height),
    };
    const crop = yield* browser.crop(
      yield* fs.readFile(picture),
      MIME[path.extname(picture)] ?? "image/jpeg",
      box
    );
    yield* fs.writeFile(
      path.join(dir, COMPONENTS_DIR, `${slugOf(c.name)}.jpg`),
      crop
    );
  }
});

/**
 * The components a family's library must have, as its screens show them: each one the product's
 * own version where another component fills its place ("Select: in this product, a dropdown
 * menu"), so an agent makes the menu and not a select nobody drew.
 */
const familyComponentList = Effect.fn("familyComponentList")(function* (
  family: string
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const file = path.join(data.familyDir(family), COMPONENTS_FILE);
  const found = (yield* fs.exists(file))
    ? (yield* readJson(FamilyComponents, file)).components
    : [];
  return COMPONENTS.map((c) => {
    const kind = found.find((f) => f.name === c.name && !f.missing)?.kind;
    const own =
      kind && kind.toLowerCase() !== c.name.toLowerCase()
        ? ` (in this product: ${kind}; make that, in this row)`
        : "";
    return `- ${c.name}${own}: ${c.states}`;
  }).join("\n");
});

/** Each component of the family, found once in its screens and cut out. */
export const familyComponents = Effect.fn("familyComponents")(function* (
  family: string,
  options: { readonly force: boolean; readonly model: string }
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const models = yield* Models;
  const dir = data.familyDir(family);
  const file = path.join(dir, COMPONENTS_FILE);
  if ((yield* fs.exists(file)) && !options.force) {
    return yield* readJson(FamilyComponents, file);
  }
  const { references } = yield* familyPictures(family);
  const files: string[] = [];
  for (const reference of references) {
    for (const f of yield* listDir(data.captureDir(reference.id))) {
      if (
        PICTURE.test(f) &&
        (f.startsWith("desktop-fold") || f.startsWith("zoom-"))
      ) {
        files.push(path.join(reference.id, "capture", f));
      }
    }
  }
  const answer = yield* models.ask({
    cwd: data.references,
    decode: FamilyComponents,
    model: options.model,
    prompt: yield* prompt("components-reference", {
      files: files.map((f) => `- ${f}`).join("\n"),
      list: componentList,
      product: family,
    }),
    schema: {
      additionalProperties: false,
      properties: {
        components: {
          items: {
            additionalProperties: false,
            properties: {
              box: {
                additionalProperties: false,
                properties: {
                  height: { type: "number" },
                  width: { type: "number" },
                  x: { type: "number" },
                  y: { type: "number" },
                },
                required: ["x", "y", "width", "height"],
                type: "object",
              },
              kind: { type: "string" },
              missing: { type: "boolean" },
              name: { enum: COMPONENTS.map((c) => c.name), type: "string" },
              picture: { type: "string" },
            },
            required: ["name", "kind", "missing", "picture", "box"],
            type: "object",
          },
          type: "array",
        },
      },
      required: ["components"],
      type: "object",
    },
  });
  const found = answer.value;
  yield* writeJson(file, found);
  yield* cutFamilyComponents(family, found);
  yield* Effect.log(
    `${family}: ${found.components.filter((c) => !c.missing).length} of ${COMPONENTS.length} components found in its screens ($${answer.costUsd.toFixed(2)})`
  );
  return found;
});

/** Every component's row of the sheet, cut out as the preview draws it. */
export const cutSheet = Effect.fn("cutSheet")(function* (
  session: UltrapaintSession,
  dir: string
) {
  const fs = yield* FileSystem.FileSystem;
  const browser = yield* Browser;
  const list = yield* rpc("listing pages", session.client["pages.list"]());
  const sheet = list.pages.find((p) => p.route === "/components");
  if (!sheet) {
    return ["no page at /components"];
  }
  const page = yield* readPageFile(path.join(session.root, sheet.file));
  // The rows are found by their layer names, wherever the agent nested them.
  const rows = new Map<string, string>();
  const visit = (node: unknown) => {
    if (!Predicate.isObject(node)) {
      return;
    }
    const name = Predicate.isString(node.name) ? node.name : undefined;
    const wanted = COMPONENTS.find(
      (c) => c.name.toLowerCase() === name?.trim().toLowerCase()
    );
    if (
      wanted &&
      Predicate.isString(node.id) &&
      node.id &&
      !rows.has(wanted.name)
    ) {
      rows.set(wanted.name, node.id);
    }
    for (const child of Array.isArray(node.children) ? node.children : []) {
      visit(child);
    }
  };
  visit(Predicate.isObject(page) ? page.root : undefined);
  yield* session.tool("set_frame", {
    height: 900,
    route: "/components",
    width: 1440,
  });
  yield* fs.makeDirectory(path.join(dir, COMPONENTS_DIR), { recursive: true });
  const problems: string[] = [];
  for (const component of COMPONENTS) {
    const node = rows.get(component.name);
    if (!node) {
      problems.push(`no row named ${component.name} on the sheet`);
      continue;
    }
    const shot = yield* session.tool("get_screenshot", {
      node,
      route: "/components",
      width: 1440,
    });
    const [png] = shot.images;
    if (shot.isError || !png) {
      problems.push(`${component.name} not drawn: ${shot.text}`);
      continue;
    }
    yield* fs.writeFile(
      path.join(dir, COMPONENTS_DIR, `${slugOf(component.name)}.png`),
      yield* browser.trim(png, CROP_MARGIN)
    );
  }
  return problems;
});

const extractOnce = Effect.fn("extractOnce")(function* (
  family: string,
  run: number,
  options: {
    readonly agent: string;
    readonly minutes: number;
    readonly model: string | undefined;
    readonly round: string;
  }
) {
  const { data } = yield* EvalsConfig;
  const dir = path.join(data.runs, options.round, family, `run-${run}`);
  const host = path.join(dir, "host");
  yield* copyHost(data.hostDir(BASE_HOST), host);
  const { pictures: screens } = yield* familyPictures(family);
  // The family's components as cut from its screens, beside the screens: the closest look at
  // each one an agent gets.
  const pictures = [...screens, ...(yield* componentPictures(family))];
  const started = Date.now();
  const problems: string[] = [];
  const said: string[] = [];
  const traces: string[] = [];
  yield* Effect.scoped(
    Effect.gen(function* () {
      const session = yield* launch(host, "own");
      const config = yield* readJson(
        Schema.Record(Schema.String, Schema.Unknown),
        path.join(host, "ultrapaint.config.json")
      );
      const list = yield* familyComponentList(family);
      const steps = [
        {
          images: pictures,
          purpose: "implement" as const,
          step: "style",
          text: yield* prompt("extract-style", {
            components: "app/src/components/ui",
            css: [config.hostCss].flat().join(", ") || "app/src/index.css",
            list,
            product: family,
          }),
        },
        {
          purpose: "design" as const,
          step: "sheet",
          text: yield* prompt("extract-sheet", { list }),
        },
      ];
      for (const step of steps) {
        const turn = yield* Effect.scoped(
          runPrompt(session, {
            agent: options.agent,
            minutes: options.minutes,
            model: options.model,
            text: step.text,
            ...(step.images && { images: step.images }),
            purpose: step.purpose,
          })
        );
        if (turn.problem) {
          problems.push(`${step.step}: ${turn.problem}`);
        }
        if (step.step === "style") {
          // The components read again, so the ones the agent added are there to draw.
          yield* rpc(
            "reading the components again",
            session.client["components.list"]()
          );
        }
        said.push(
          `## ${step.step}\n\n${turn.items
            .filter((i) => i.kind === "agent")
            .map((i) => (i.kind === "agent" ? i.text : ""))
            .join("\n\n")
            .trim()}`
        );
        traces.push(`## ${step.step}\n\n${traceOf(turn.items)}`);
      }
      problems.push(...(yield* cutSheet(session, dir)));
    })
  );
  yield* writeText(path.join(dir, "agent.md"), `${said.join("\n\n")}\n`);
  yield* writeText(path.join(dir, "trace.md"), `${traces.join("\n\n")}\n`);
  yield* writeJson(path.join(dir, "run.json"), {
    agent: options.agent,
    problems,
    seconds: Math.round((Date.now() - started) / 1000),
  });
  yield* Effect.log(
    `${family} run ${run}: ${Math.round((Date.now() - started) / 60_000)} min${problems.length > 0 ? `; ${problems.join("; ")}` : ""}`
  );
});

/** Track A: each family's design system extracted from its screens, several times. */
export const extract = Effect.fn("extract")(function* (
  families: readonly string[],
  options: {
    readonly agent: string;
    readonly judgeModel: string;
    readonly minutes: number;
    readonly model: string | undefined;
    readonly round: string;
    readonly runs: number;
  }
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const all = [...new Set((yield* loadReferences([])).map(familyOf))];
  const chosen = families.length > 0 ? families : all;
  for (const family of chosen) {
    yield* familyComponents(family, {
      force: false,
      model: options.judgeModel,
    });
    const info = path.join(data.runs, options.round, "round.json");
    if (!(yield* fs.exists(info))) {
      yield* writeJson(info, {
        agent: options.agent,
        commit: yield* commitOf,
        family: chosen.join(", "),
        ...(options.model !== undefined && { model: options.model }),
        name: options.round,
        runs: options.runs,
        startedAt: new Date().toISOString(),
        track: "extract",
      });
    }
    for (let run = 1; run <= options.runs; run += 1) {
      const done = path.join(
        data.runs,
        options.round,
        family,
        `run-${run}`,
        "run.json"
      );
      if (yield* fs.exists(done)) {
        continue;
      }
      yield* extractOnce(family, run, options).pipe(
        Effect.catch((error) =>
          Effect.logError(`${family} run ${run} failed: ${String(error)}`)
        )
      );
    }
  }
  yield* Effect.log(
    `extracted: ${data.fromData(path.join(data.runs, options.round))}`
  );
});

/**
 * A run's design system made a family's library: its host copied to `hosts/<family>`, where
 * track B's rounds compose that family's screens.
 */
export const freeze = Effect.fn("freeze")(function* (
  round: string,
  family: string,
  run: number
) {
  const { data } = yield* EvalsConfig;
  const fs = yield* FileSystem.FileSystem;
  const from = path.join(data.runs, round, family, `run-${run}`, "host");
  if (!(yield* fs.exists(from))) {
    return yield* Effect.logError(`no host at ${data.fromData(from)}`);
  }
  const to = path.join(data.hosts, family);
  yield* copyHost(from, to);
  yield* writeText(
    path.join(to, "FROZEN.md"),
    `The library of ${family}, frozen from ${data.fromData(from)} on ${new Date().toISOString()}.\n`
  );
  yield* Effect.log(
    `${family}: library frozen into ${path.relative(data.root, to)}`
  );
});
