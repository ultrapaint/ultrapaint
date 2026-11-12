import type { SelectedNode } from "@ultrapaint/contracts/rpc";
import { Context, Effect, Layer, Ref } from "effect";

/**
 * What is selected in the editor, as the editor last said (`editor.select`): what an agent
 * outside the editor is told when asked about "what I've selected" (ADR 0083). An editor that
 * goes takes its selection along.
 */
export class EditorSelection extends Context.Service<
  EditorSelection,
  {
    readonly current: Effect.Effect<readonly SelectedNode[]>;
    readonly set: (nodes: readonly SelectedNode[]) => Effect.Effect<void>;
  }
>()("ultrapaint/server/EditorSelection") {
  static readonly layer = Layer.effect(
    EditorSelection,
    Effect.map(Ref.make<readonly SelectedNode[]>([]), (selected) =>
      EditorSelection.of({
        current: Ref.get(selected),
        set: (nodes) => Ref.set(selected, nodes),
      })
    )
  );
}
