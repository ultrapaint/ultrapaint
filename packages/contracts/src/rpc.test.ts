import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { DesignSystem, emptyDesignSystem } from "./design-system.ts";
import { DocOp, PageDocument } from "./document.ts";
import { CommandFailed, errorCodes, NotFound } from "./errors.ts";
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

  it("round-trips every kind of document operation", () => {
    const ops: DocOp[] = [
      {
        index: 0,
        node: { id: "t1", role: "paragraph", text: "Hi", type: "text" },
        op: "insert",
        parent: "root",
      },
      { id: "t1", op: "remove" },
      { id: "t1", index: 2, op: "move", parent: null },
      { id: "t1", op: "update", set: { fill: "$color-primary", gap: null } },
      { id: "b1", op: "setProps", props: { variant: "ghost" } },
      { ids: ["a", "b"], op: "wrap", type: "row" },
      { id: "r1", op: "unwrap" },
      { id: "r1", op: "duplicate" },
    ];
    for (const op of ops) {
      expect(overTheWire(DocOp, op)).toEqual(op);
    }
  });

  it("reads a page and refuses one whose root is not a page", () => {
    const page: PageDocument = {
      root: {
        children: [
          {
            children: [
              {
                component: "Button",
                from: "@ui/button",
                id: "b1",
                props: { size: "sm" },
                text: "Go",
                type: "instance",
              },
            ],
            gap: "$spacing-4",
            id: "r1",
            type: "row",
            width: "fill",
          },
        ],
        id: "root",
        type: "page",
      },
      version: 1,
    };
    expect(overTheWire(PageDocument, page)).toEqual(page);
    expect(() =>
      Schema.decodeUnknownSync(PageDocument)({
        root: { children: [], id: "g", type: "group" },
        version: 1,
      })
    ).toThrow();
  });

  it("carries the design system over the wire", () => {
    expect(overTheWire(DesignSystem, emptyDesignSystem())).toEqual(
      emptyDesignSystem()
    );
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
      changedFiles: ["designs/a.page.json"],
      id: "item_2",
      kind: "turn_end",
      stopReason: "end_turn",
    };
    expect(overTheWire(ThreadItem, permission)).toEqual(permission);
    expect(overTheWire(ThreadItem, turnEnd)).toEqual(turnEnd);
  });

  it("has one event stream per event and a code for every wire error", () => {
    for (const name of eventNames) {
      expect(UltrapaintRpcs.requests.has(`events.${name}`)).toBe(true);
    }
    expect(errorCodes[new NotFound({ message: "x" })._tag]).toBe("not_found");
    // A git command that failed is not a bug of the server's.
    expect(errorCodes[new CommandFailed({ message: "x" })._tag]).toBe(
      "command_failed"
    );
  });
});
