/**
 * A design target (ADR 0030): the page or the component spec an agent or a user names to
 * implement, mark or note, by one rule (`designTargetNamed`) for `/implement`, `handoff` and the
 * link to the code, and its behaviour notes, read and added whichever way they are kept: a page's
 * are comments pinned on it (resolved when done), a component's are kept in its spec (deleted
 * when done). It sits above the specs, the comments and the link, which it reads.
 */
import {
  BadRequest,
  type Conflict,
  type ForbiddenPath,
  NotFound,
} from "@ultrapaint/contracts/errors";
import {
  isSpecTarget,
  specTarget,
} from "@ultrapaint/contracts/implementation";
import type { Page } from "@ultrapaint/contracts/pages";
import type { ComponentSpec } from "@ultrapaint/contracts/specs";
import { findNode, nodeLabel } from "@ultrapaint/design-document/tree";
import { Context, Effect, Layer } from "effect";
import { CommentsService } from "./comments.ts";
import { DocumentService } from "./documents.ts";
import type { EditFailure } from "./edit.ts";
import {
  commentNote,
  type Note,
  pageNotes,
  specNote,
  specNotes,
} from "./implementation.ts";
import { designTargetNamed } from "./page-names.ts";
import { PagesService } from "./pages.ts";
import { SpecService } from "./specs.ts";

/** A design a name settled on: a page, maybe one of its nodes, or a component's spec. */
export type DesignTarget =
  | { readonly _tag: "Page"; readonly nodeId?: string; readonly page: Page }
  | { readonly _tag: "Spec"; readonly spec: ComponentSpec };

/** The target the link to the code keys a design by: a page's id, or `spec:<Component>`. */
export const targetId = (target: DesignTarget) =>
  target._tag === "Spec" ? specTarget(target.spec.component) : target.page.id;

/** A page as a list shows it: its name, its URL or that it has none, its file. */
export const pageEntry = (page: {
  readonly file: string;
  readonly name: string;
  readonly route?: string | undefined;
  readonly variant?: string | undefined;
}) =>
  `${page.name}${page.variant ? ` (variant ${page.variant})` : ""}, ${page.route ?? "no URL"}: ${page.file}`;

const quoted = (id: string) => JSON.stringify(id);

const listed = (lines: readonly string[], kind: string) =>
  lines.length > 0
    ? `the ${kind} are:\n${lines.map((line) => `- ${line}`).join("\n")}`
    : `there are no ${kind}`;

export class DesignTargets extends Context.Service<
  DesignTargets,
  {
    /**
     * The design a name means, in the canvas given when one is: a miss says which kind it looked
     * for and lists that kind, pages of several canvases say which.
     */
    readonly resolve: (
      name: string,
      canvas?: string
    ) => Effect.Effect<DesignTarget, NotFound | BadRequest>;
    /** A design's open behaviour notes, as an implementation task carries them. */
    readonly notes: (target: DesignTarget) => Effect.Effect<readonly Note[]>;
    /**
     * A behaviour note on a design (one undo step): on a page's node (the target's, or `node`),
     * or on a spec's slot (`node`) or the whole component. A node reference and another `node`
     * are refused rather than one picked.
     */
    readonly addNote: (
      target: DesignTarget,
      text: string,
      node?: string
    ) => Effect.Effect<
      Note,
      NotFound | BadRequest | Conflict | ForbiddenPath | EditFailure
    >;
  }
>()("ultrapaint/server/DesignTargets") {
  static readonly layer = Layer.effect(
    DesignTargets,
    Effect.gen(function* () {
      const pagesService = yield* PagesService;
      const specService = yield* SpecService;
      const comments = yield* CommentsService;
      const documents = yield* DocumentService;

      const resolve = Effect.fn("DesignTargets.resolve")(function* (
        name: string,
        canvas?: string
      ) {
        const { pages } = yield* pagesService.list;
        const specs = yield* specService.specs;
        const named = designTargetNamed(pages, specs, name, canvas);
        if (named._tag === "Page" || named._tag === "Spec") {
          return named satisfies DesignTarget;
        }
        const allPages = listed(pages.map(pageEntry), "pages");
        if (named._tag === "Ambiguous") {
          return yield* new BadRequest({
            message: `${name} is a page in several canvases (${named.canvases.map(quoted).join(", ")}); ${allPages}`,
          });
        }
        const where = name.trim();
        if (named.kind === "spec") {
          const bare = isSpecTarget(where)
            ? ""
            : " (a page is named by its URL or its file)";
          return yield* new NotFound({
            message: `no component spec is ${where}${bare}; ${listed(
              specs.map((s) => s.component),
              "component specs"
            )}`,
          });
        }
        const inCanvas =
          canvas === undefined ? "" : ` in canvas ${quoted(canvas)}`;
        return yield* new NotFound({
          message: `${where === "" ? "it did not say which page" : `no page is ${where}${inCanvas}`}; ${allPages}`,
        });
      });

      const notes = (target: DesignTarget) =>
        target._tag === "Spec"
          ? Effect.succeed(specNotes(target.spec))
          : comments.list(target.page.canvas).pipe(
              Effect.map(({ comments: all }) => pageNotes(target.page, all)),
              // A comments file that does not read holds no note to carry.
              Effect.orElseSucceed((): Note[] => [])
            );

      const addNote = Effect.fn("DesignTargets.addNote")(function* (
        target: DesignTarget,
        text: string,
        node?: string
      ) {
        if (target._tag === "Spec") {
          return specNote(
            yield* specService.addNote(target.spec.component, text, node)
          );
        }
        const { nodeId, page } = target;
        if (node !== undefined && nodeId !== undefined && node !== nodeId) {
          return yield* new BadRequest({
            message: `the target names the node ${nodeId}, and node says ${node}: say one`,
          });
        }
        const id = nodeId ?? node;
        const { root } = yield* documents.get(page.id);
        const found = id === undefined ? null : findNode(root, id);
        if (id !== undefined && !found) {
          return yield* new NotFound({
            message: `no node ${id} in ${page.file}`,
          });
        }
        return commentNote(
          yield* comments.create({
            canvas: page.canvas,
            element: found ? nodeLabel(found) : null,
            kind: "behaviour",
            nodeId: found?.id ?? null,
            page: page.path,
            text,
            x: 0,
            y: 0,
          })
        );
      });

      return DesignTargets.of({ addNote, notes, resolve });
    })
  );
}
