/**
 * The rounds of takes agents make on `Variations` tasks (ADR 0098). Before the turn, the server
 * makes one working copy per take (`working-copies.ts`) and the task names them; the agent
 * changes each with the tools it has, then renames it (`rename_page`) to the take's name and what
 * it varied, which hands it in: the take is saved into the thing's set and the copy removed, so
 * the person can choose the first while the others are made. A copy still unnamed when the turn
 * ends failed: it is removed, and the editor draws its take as a red box with Try again.
 *
 * The rounds are the server's while it runs, told to the editor as they change; a round whose
 * takes all came in is forgotten when its turn ends, and one with a failed take when the thing's
 * next round begins (Try again).
 */
import { componentOfDoc } from "@ultrapaint/contracts/components";
import type { DesignNode, PageDocument } from "@ultrapaint/contracts/document";
import { BadRequest, Conflict, NotFound } from "@ultrapaint/contracts/errors";
import type { Page } from "@ultrapaint/contracts/pages";
import {
  type TakeState,
  takeNameOf,
  type VariationRound,
  type VariationTarget,
} from "@ultrapaint/contracts/variations";
import { serialise } from "@ultrapaint/design-document/factories";
import {
  canvasOfDoc,
  findNode,
  isPageFile,
} from "@ultrapaint/design-document/tree";
import { plural } from "@ultrapaint/shared/text";
import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { EventBus } from "../events.ts";
import { makeId } from "../ids.ts";
import { DocumentService } from "./documents.ts";
import type { EditFailure } from "./edit.ts";
import { PagesService } from "./pages.ts";
import { RepoPaths } from "./repo-paths.ts";
import { VariationsService } from "./variations.ts";
import { WORKING_COPIES_DIR } from "./working-copies.ts";

/** The id of the page a working copy draws a thing beside the pages, or a component's tree, in. */
const HOLDER_ID = "working-copy";

/** One take's working copy, and where the take stands. */
interface Copy {
  /** Its document: its path in the designs directory, as a page's is. */
  readonly doc: string;
  /** Repository-relative, as the agent names it. */
  readonly file: string;
  state: TakeState;
  variation?: string;
}

interface Round {
  readonly canvas: string;
  readonly copies: Copy[];
  readonly id: string;
  readonly target: VariationTarget;
  readonly thread: string;
  readonly vary?: string | undefined;
}

/** A round asked for: how many takes of which thing, in which chat, and what should vary. */
export interface RoundRequest {
  readonly count: number;
  readonly target: VariationTarget;
  readonly thread: string;
  readonly vary?: string | undefined;
}

/** What a round began with: the thing, and the working copies the task names. */
export interface RoundStart {
  readonly copies: readonly {
    readonly doc: string;
    readonly file: string;
  }[];
  /** The page the thing is drawn in; null for a node beside the pages or a component's tree. */
  readonly page: Page | null;
  readonly round: VariationRound;
  readonly thing: DesignNode;
  /** The thing is its page's root: each take is the whole page. */
  readonly whole: boolean;
}

/** A working copy as the agent's tools find it, and the thing whose take it is. */
export interface WorkingCopy {
  readonly page: Page;
  readonly target: VariationTarget;
}

const roundOf = (round: Round): VariationRound => ({
  ...round.target,
  id: round.id,
  takes: round.copies.map((c) => ({
    state: c.state,
    ...(c.variation !== undefined && { variation: c.variation }),
  })),
  thread: round.thread,
  ...(round.vary !== undefined && { vary: round.vary }),
});

export class VariationRounds extends Context.Service<
  VariationRounds,
  {
    /** The working copy a tool was given, by its file, its document or its name; null if none. */
    readonly copyNamed: (named: string) => WorkingCopy | null;
    /**
     * A take handed in: its copy's thing saved into the set as a variation named as the agent
     * named the copy ("Editorial · Tone of the copy"), and the copy removed. Answers with it.
     */
    readonly handIn: (
      doc: string,
      named: string
    ) => Effect.Effect<
      { readonly name: string; readonly variation: string },
      EditFailure
    >;
    /** The rounds under way, and those with a take that failed. */
    readonly list: Effect.Effect<readonly VariationRound[]>;
    /** A round begun for a thread's turn: its working copies made, one per take. */
    readonly start: (
      request: RoundRequest
    ) => Effect.Effect<RoundStart, EditFailure>;
    /**
     * The thread's turn ended: its takes still being made failed and their copies are removed.
     * Answers with how many failed, and how many were asked for.
     */
    readonly turnEnded: (
      thread: string
    ) => Effect.Effect<{ readonly asked: number; readonly failed: number }>;
  }
>()("ultrapaint/server/VariationRounds") {
  static readonly layer = Layer.effect(
    VariationRounds,
    Effect.gen(function* () {
      const paths = yield* RepoPaths;
      const documents = yield* DocumentService;
      const variations = yield* VariationsService;
      const pages = yield* PagesService;
      const events = yield* EventBus;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = path.join(paths.designsDir, WORKING_COPIES_DIR);

      let rounds: Round[] = [];
      /** The copies being handed in now. */
      const handing = new Set<Copy>();

      const cannot = (message: string) => new Conflict({ message });

      // Copies a server stopped mid-turn left behind belong to no round.
      yield* fs
        .remove(dir, { force: true, recursive: true })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`${dir} could not be cleared`, cause)
          )
        );

      const publish = Effect.suspend(() =>
        events.publish("variationRounds", rounds.map(roundOf))
      );

      const copyOf = (doc: string) => {
        for (const round of rounds) {
          const copy = round.copies.find((c) => c.doc === doc);
          if (copy) {
            return { copy, round };
          }
        }
        return null;
      };

      const removeFile = (copy: Copy) =>
        Effect.flatMap(paths.resolve(copy.file), (abs) =>
          fs.remove(abs, { force: true })
        ).pipe(
          // A copy that cannot be removed is scratch nothing reads; it goes with the next start.
          Effect.catchCause((cause) =>
            Effect.logWarning(`${copy.file} could not be removed`, cause)
          )
        );

      /** The page a working copy is, as the agent's tools look for one. */
      const pageOf = (round: Round, copy: Copy, n: number): Page => ({
        canvas: round.canvas,
        file: copy.file,
        id: copy.doc,
        name: `Take ${n}`,
        path: copy.doc,
      });

      const copyNamed = (named: string): WorkingCopy | null => {
        const wanted = named.trim();
        for (const round of rounds) {
          const at = round.copies.findIndex(
            (c) =>
              c.state === "working" && (c.doc === wanted || c.file === wanted)
          );
          const copy = round.copies[at];
          if (copy) {
            return { page: pageOf(round, copy, at + 1), target: round.target };
          }
        }
        return null;
      };

      /** What a copy holds: a page's whole page, or the thing alone in a page of its own. */
      const contentFor = Effect.fnUntraced(function* (
        target: VariationTarget,
        thing: DesignNode
      ) {
        if (isPageFile(target.doc)) {
          const file = yield* paths.resolve(
            yield* documents.fileOf(target.doc)
          );
          return yield* fs
            .readFileString(file)
            .pipe(
              Effect.mapError((error) =>
                cannot(`${target.doc} cannot be read: ${error.message}`)
              )
            );
        }
        const holder: PageDocument = {
          root: { children: [thing], id: HOLDER_ID, type: "page" },
          version: 1,
        };
        return serialise(holder);
      });

      const start = Effect.fn("VariationRounds.start")(function* (
        input: RoundRequest
      ) {
        const { target } = input;
        const state = yield* documents.get(target.doc);
        const thing = findNode(state.root, target.node);
        if (thing === null) {
          return yield* new NotFound({
            message: `there is no node ${target.node} in ${target.doc}`,
          });
        }
        if (thing.id === HOLDER_ID && !isPageFile(target.doc)) {
          return yield* new BadRequest({
            message: `${HOLDER_ID} is the working copies' own id`,
          });
        }
        const list = yield* pages.list;
        const page = list.pages.find((p) => p.id === target.doc) ?? null;
        const canvas =
          page?.canvas ??
          canvasOfDoc(target.doc) ??
          // A component's tree is drawn in the first canvas's look.
          (componentOfDoc(target.doc) === null
            ? ""
            : (list.canvases[0]?.id ?? ""));
        const content = yield* contentFor(target, thing);
        const id = yield* makeId("round");
        yield* fs.makeDirectory(dir, { recursive: true }).pipe(
          Effect.andThen(
            fs.writeFileString(path.join(dir, ".gitignore"), "*\n")
          ),
          Effect.mapError((error) =>
            cannot(`the working copies cannot be made: ${error.message}`)
          )
        );
        const copies: Copy[] = [];
        for (let n = 1; n <= input.count; n += 1) {
          const abs = path.join(dir, `${id}-${n}.page.json`);
          yield* fs
            .writeFileString(abs, content)
            .pipe(
              Effect.mapError((error) =>
                cannot(`a working copy cannot be made: ${error.message}`)
              )
            );
          copies.push({
            doc: `${WORKING_COPIES_DIR}/${path.basename(abs)}`,
            file: paths.relative(abs),
            state: "working",
          });
        }
        const round: Round = {
          canvas,
          copies,
          id,
          target,
          thread: input.thread,
          vary: input.vary,
        };
        // Its failed takes are asked for again by this round (Try again); its others are in.
        rounds = [
          ...rounds.filter(
            (r) =>
              r.target.doc !== target.doc ||
              r.target.node !== target.node ||
              r.copies.some((c) => c.state === "working")
          ),
          round,
        ];
        yield* publish;
        // The thing is outlined in the agent's colour from the start of its work.
        yield* events.publish("agent.focus", {
          action: `Making ${plural(input.count, "variation")}`,
          nodeIds: [target.node],
          pageId: target.doc,
          threadId: input.thread,
        });
        return {
          copies: copies.map(({ doc, file }) => ({ doc, file })),
          page,
          round: roundOf(round),
          thing,
          whole: page !== null && state.root?.id === target.node,
        } satisfies RoundStart;
      });

      const handIn = Effect.fn("VariationRounds.handIn")(function* (
        doc: string,
        named: string
      ) {
        const found = copyOf(doc);
        if (found === null) {
          return yield* new NotFound({
            message: `${doc} is no working copy of a round under way`,
          });
        }
        const { copy, round } = found;
        if (copy.state !== "working" || handing.has(copy)) {
          return yield* new BadRequest({
            message: `${copy.file} was handed in already`,
          });
        }
        // One hand-in of a copy at a time: a second rename while it is saved is refused.
        handing.add(copy);
        return yield* save(copy, round, named).pipe(
          Effect.ensuring(Effect.sync(() => handing.delete(copy)))
        );
      });

      /** A take saved into its thing's set, and its copy removed. */
      const save = Effect.fnUntraced(function* (
        copy: Copy,
        round: Round,
        named: string
      ) {
        const { name, varied } = takeNameOf(named);
        if (name === "") {
          return yield* new BadRequest({
            message:
              "name the take and what it varied: “Editorial · Tone of the copy”",
          });
        }
        const state = yield* documents.get(copy.doc);
        const tree = findNode(state.root, round.target.node);
        if (tree === null) {
          return yield* new BadRequest({
            message: `${copy.file} no longer has node ${round.target.node}, the thing the take is of: put it back, its id kept, and hand it in again`,
          });
        }
        const variation = yield* variations.addTake(round.target, {
          name,
          tree,
          varied,
        });
        copy.state = "handedIn";
        copy.variation = variation;
        yield* removeFile(copy);
        yield* publish;
        return { name, variation };
      });

      const turnEnded = Effect.fn("VariationRounds.turnEnded")(function* (
        thread: string
      ) {
        let asked = 0;
        let failed = 0;
        for (const round of rounds) {
          if (round.thread !== thread) {
            continue;
          }
          for (const copy of round.copies) {
            if (copy.state === "working") {
              asked += 1;
              failed += 1;
              copy.state = "failed";
              yield* removeFile(copy);
            } else if (copy.state === "handedIn") {
              asked += 1;
            }
          }
        }
        if (asked === 0) {
          return { asked, failed };
        }
        // A round whose takes all came in has nothing more to show.
        rounds = rounds.filter(
          (r) =>
            r.thread !== thread || r.copies.some((c) => c.state === "failed")
        );
        yield* publish;
        return { asked, failed };
      });

      return VariationRounds.of({
        copyNamed,
        handIn,
        list: Effect.sync(() => rounds.map(roundOf)),
        start,
        turnEnded,
      });
    })
  );
}
