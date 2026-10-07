/**
 * The editor's own tools, offered to agents over MCP.
 *
 * What an agent otherwise has to piece together by reading the repository — where the designs
 * are, what pages exist, which components it may use and what props they take — the server
 * already knows. These answer it in one call. Pages are design documents the editor owns, so
 * changing one goes through the same operations the editor uses (`apply_operations`), which
 * validate every change and make it one undo step; the design system is written the same way.
 */
import { Effect } from "effect";
import { Toolkit } from "effect/ai";
import {
  CopyPages,
  CreateCanvas,
  canvasToolHandlers,
  ListLinks,
  SetHome,
} from "./canvas-tools.ts";
import {
  commentToolHandlers,
  ListComments,
  ReplyToComment,
  ResolveComment,
} from "./comment-tools.ts";
import {
  designSystemToolHandlers,
  GetComponent,
  ListComponents,
  ReadDesignSystem,
  ScanDesignSystem,
  WriteDesignSystem,
} from "./design-system-tools.ts";
import {
  ApplyOperations,
  documentToolHandlers,
  Focus,
  GetDocumentFormat,
  ReadCanvas,
  ReadPage,
} from "./document-tools.ts";
import {
  CreatePage,
  DeletePage,
  DuplicatePage,
  GetContext,
  ListPages,
  ListTemplates,
  pageToolHandlers,
  RenamePage,
  SetFrame,
  SetPageUrl,
} from "./page-tools.ts";

export const EditorTools = Toolkit.make(
  GetContext,
  ListPages,
  ReadPage,
  ReadCanvas,
  GetDocumentFormat,
  ApplyOperations,
  ScanDesignSystem,
  ReadDesignSystem,
  WriteDesignSystem,
  ListComponents,
  GetComponent,
  ListComments,
  ListTemplates,
  CreatePage,
  SetFrame,
  RenamePage,
  SetPageUrl,
  DeletePage,
  DuplicatePage,
  CopyPages,
  CreateCanvas,
  SetHome,
  ListLinks,
  ReplyToComment,
  ResolveComment,
  Focus
);

export const EditorToolsLive = EditorTools.toLayer(
  Effect.gen(function* () {
    return {
      ...(yield* canvasToolHandlers),
      ...(yield* commentToolHandlers),
      ...(yield* designSystemToolHandlers),
      ...(yield* documentToolHandlers),
      ...(yield* pageToolHandlers),
    };
  })
);
