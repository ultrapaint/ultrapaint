/**
 * A design target (ADR 0030): the page or the component an agent or a user names to implement,
 * mark or note, by one rule (`designTargetNamed`) for `/implement`, `handoff` and the link to the
 * code, and its behaviour notes, read and added whichever way they are kept: a page's are
 * comments pinned on it (resolved when done), a component's are kept in its file (deleted when
 * done). It sits above the components, the comments and the link, which it reads.
 */

import type { ComponentFile } from "@ultrapaint/contracts/components";
import {
  BadRequest,
  type Conflict,
  type ForbiddenPath,
  NotFound,
} from "@ultrapaint/contracts/errors";
import {
  componentTarget,
  isComponentTarget,
} from "@ultrapaint/contracts/implementation";
import type { Page } from "@ultrapaint/contracts/pages";
import { findNode, nodeLabel } from "@ultrapaint/design-document/tree";
import { Context, Effect, Layer } from "effect";
import { CommentsService } from "./comments.ts";
import { ComponentService } from "./components.ts";
import { DocumentService } from "./documents.ts";
import type { EditFailure } from "./edit.ts";
import {
  commentNote,
  componentNote,
  componentNotes,
  type Note,
  pageNotes,
} from "./implementation.ts";
import { designTargetNamed, listedAs, pageMissed } from "./page-names.ts";
import { PagesService } from "./pages.ts";

/** A design a name settled on: a page, maybe one of its nodes, or a component. */
export type DesignTarget =
  | { readonly _tag: "Page"; readonly nodeId?: string; readonly page: Page }
  | { readonly _tag: "Component"; readonly component: ComponentFile };

/** The target the link to the code keys a design by: a page's id, or `component:<Name>`. */
export const targetId = (target: DesignTarget) =>
  target._tag === "Component"
    ? componentTarget(target.component.name)
    : target.page.id;

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
     * or on a component's part (`node`) or the whole component. A node reference and another `node`
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
      const componentService = yield* ComponentService;
      const comments = yield* CommentsService;
      const documents = yield* DocumentService;

      const resolve = Effect.fn("DesignTargets.resolve")(function* (
        name: string,
        canvas?: string
      ) {
        const { pages } = yield* pagesService.list;
        const components = yield* componentService.components;
        const named = designTargetNamed(pages, components, name, canvas);
        if (named._tag === "Page" || named._tag === "Component") {
          return named satisfies DesignTarget;
        }
        if (named._tag === "Ambiguous") {
          return yield* new BadRequest({
            message: pageMissed(pages, named, name),
          });
        }
        const where = name.trim();
        if (named.kind === "component") {
          const bare = isComponentTarget(where)
            ? ""
            : " (a page is named by its URL or its file)";
          return yield* new NotFound({
            message: `no component is ${where}${bare}; ${listedAs(
              components.map((c) => c.name),
              "components with a file"
            )}`,
          });
        }
        return yield* new NotFound({
          message: pageMissed(pages, named, name, canvas),
        });
      });

      const notes = (target: DesignTarget) =>
        target._tag === "Component"
          ? Effect.succeed(componentNotes(target.component))
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
        if (target._tag === "Component") {
          const { component } = yield* componentService.change(
            target.component.name,
            { op: "addNote", text, ...(node !== undefined && { slot: node }) }
          );
          // The note added is the file's last.
          const added = component?.notes?.at(-1);
          if (!added) {
            return yield* new NotFound({
              message: `${target.component.name} took no note`,
            });
          }
          return componentNote(added);
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
