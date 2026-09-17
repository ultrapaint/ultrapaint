import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { parseSourceKey, sourceKey } from "./base.ts";
import { EditOp } from "./edit.ts";
import { errorCodes, NotFound } from "./errors.ts";
import { HostMessage, TreeNode } from "./preview.ts";
import { UltrapaintRpcs, eventNames } from "./rpc.ts";
import { Settings } from "./settings.ts";
import { ThreadItem } from "./threads.ts";

/** What comes back after encoding, a trip through real JSON, and decoding. */
const overTheWire = <S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  value: S["Type"]
): S["Type"] =>
  Schema.decodeUnknownSync(schema)(
    JSON.parse(JSON.stringify(Schema.encodeSync(schema)(value)))
  );

describe("contracts", () => {
  it("round-trips settings and leaves optional fields out", () => {
    const settings: Settings = {
      componentPackages: [],
      designsDir: "designs",
      hostCss: [],
      libraryDirs: [],
      repoPath: "/tmp/repo",
      theme: "light",
    };
    expect(overTheWire(Settings, settings)).toEqual(settings);
  });

  it("rejects settings that escape the repository", () => {
    const decode = Schema.decodeUnknownSync(Settings);
    expect(() =>
      decode({
        componentPackages: [],
        designsDir: "../outside",
        hostCss: [],
        libraryDirs: [],
        repoPath: "/tmp/repo",
        theme: "light",
      })
    ).toThrow();
  });

  it("round-trips every kind of edit", () => {
    const target = { col: 4, file: "designs/a.tsx", line: 12 };
    const ops: EditOp[] = [
      { add: ["p-2"], kind: "setClasses", remove: ["p-1"], target },
      {
        kind: "setAttribute",
        name: "variant",
        target,
        value: { nested: [1, null] },
      },
      { kind: "setText", target, text: "Hello" },
      { kind: "delete", target },
      { kind: "duplicate", target },
      { index: 0, into: target, kind: "move", target },
      {
        imports: [{ from: "@ui/button", name: "Button" }],
        index: 1,
        into: target,
        jsx: "<Button />",
        kind: "insert",
      },
    ];
    for (const op of ops) {
      expect(overTheWire(EditOp, op)).toEqual(op);
    }
  });

  it("round-trips transcript items, including a permission still undecided", () => {
    const permission: ThreadItem = {
      at: 1,
      decision: null,
      id: "perm_1",
      kind: "permission",
      options: [{ kind: "allow_once", name: "Allow", optionId: "allow" }],
      requestId: "perm_1",
      title: "Edit file",
    };
    const turnEnd: ThreadItem = {
      at: 2,
      changedFiles: ["designs/a.tsx"],
      id: "item_2",
      kind: "turn_end",
      stopReason: "end_turn",
    };
    expect(overTheWire(ThreadItem, permission)).toEqual(permission);
    expect(overTheWire(ThreadItem, turnEnd)).toEqual(turnEnd);
  });

  it("round-trips the recursive preview tree inside a host message", () => {
    const leaf: TreeNode = {
      children: [],
      editable: false,
      id: "n2",
      kind: "text",
      name: "#text",
      source: null,
      summary: "Hello",
    };
    const tree: TreeNode = {
      ...leaf,
      children: [leaf],
      id: "n1",
      kind: "element",
      name: "div",
    };
    const message: HostMessage = { tree, type: "ed:tree" };
    expect(overTheWire(TreeNode, tree)).toEqual(tree);
    expect(overTheWire(HostMessage, message)).toEqual(message);
  });

  it("source keys round-trip", () => {
    const loc = { col: 4, file: "products/prime/designs/a.tsx", line: 12 };
    expect(parseSourceKey(sourceKey(loc))).toEqual(loc);
  });

  it("has one event stream per event and a code for every wire error", () => {
    for (const name of eventNames) {
      expect(UltrapaintRpcs.requests.has(`events.${name}`)).toBe(true);
    }
    expect(errorCodes[new NotFound({ message: "x" })._tag]).toBe("not_found");
  });
});
