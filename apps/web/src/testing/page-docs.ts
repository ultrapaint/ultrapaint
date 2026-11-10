/**
 * Pages' documents as a test loads them: each an empty root, the page as a whole that selecting
 * the page selects (ADR 0075).
 */
import type { DocumentState } from "@ultrapaint/contracts/document";

/** A page's document with an empty root. */
export const pageDoc = (id: string): DocumentState => ({
  doc: id,
  hash: `${id}@0`,
  root: { children: [], id: "root", type: "page" },
});

/** The documents of these pages, by id. */
export const pageDocs = (
  ids: readonly string[]
): Record<string, DocumentState> =>
  Object.fromEntries(ids.map((id) => [id, pageDoc(id)]));
