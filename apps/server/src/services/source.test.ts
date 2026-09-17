import { describe, expect, it } from "vitest";
import {
  applyDelete,
  applyDuplicate,
  applyInsert,
  applyMove,
  applySetAttribute,
  applySetClasses,
  applySetText,
  collectElements,
  elementSource,
  mergeClasses,
  parseTsx,
} from "./source.ts";

const file = "designs/a.tsx";
const code = `import { Button } from "@ds/button";
import { Card } from "@ds/card";

export default function A() {
  return (
    <main className="flex flex-col gap-4 p-4">
      <Card>
        <Button size="sm" variant="ghost">
          Hello
        </Button>
        <p>Text</p>
      </Card>
    </main>
  );
}
`;

const at = (line: number, col: number) => ({ file, line, col });

describe("source engine", () => {
  it("reads an element", () => {
    const src = elementSource(code, file, at(8, 8), true);
    expect(src?.name).toBe("Button");
    expect(src?.attributes.map((a) => [a.name, a.value])).toEqual([
      ["size", "sm"],
      ["variant", "ghost"],
    ]);
    expect(src?.text).toBe("Hello");
  });

  it("merges tailwind classes replacing conflicts", () => {
    expect(mergeClasses("flex p-4 text-sm", ["p-6"], [])).toBe("flex text-sm p-6");
    expect(mergeClasses("flex p-4", [], ["p-4"])).toBe("flex");
  });

  it("rewrites className in place", () => {
    const out = applySetClasses(code, at(6, 4), ["p-8"], []);
    expect(out.code).toContain(`<main className="flex flex-col gap-4 p-8">`);
    expect(out.code.split("\n").length).toBe(code.split("\n").length);
  });

  it("adds className alphabetically when missing", () => {
    const out = applySetClasses(code, at(8, 8), ["mt-2"], []);
    expect(out.code).toContain(`<Button className="mt-2" size="sm" variant="ghost">`);
  });

  it("sets, changes and removes attributes", () => {
    let out = applySetAttribute(code, at(8, 8), "variant", "outline").code;
    expect(out).toContain(`variant="outline"`);
    out = applySetAttribute(out, at(8, 8), "disabled", true).code;
    expect(out).toContain(`<Button disabled size="sm" variant="outline">`);
    out = applySetAttribute(out, at(8, 8), "size", null).code;
    expect(out).toContain(`<Button disabled variant="outline">`);
    out = applySetAttribute(out, at(8, 8), "count", 3).code;
    expect(out).toContain(`count={3}`);
  });

  it("sets text", () => {
    const out = applySetText(code, at(11, 8), "Changed {x}").code;
    expect(out).toContain(`<p>{"Changed {x}"}</p>`);
  });

  it("deletes and drops unused imports", () => {
    const out = applyDelete(code, at(8, 8)).code;
    expect(out).not.toContain("<Button");
    expect(out).not.toContain(`import { Button }`);
    expect(out).toContain(`import { Card }`);
  });

  it("duplicates after the element and tracks the copy", () => {
    const out = applyDuplicate(code, at(11, 8));
    expect(out.code.match(/<p>Text<\/p>/g)?.length).toBe(2);
    const els = collectElements(parseTsx(out.code));
    expect(els[out.trackIndex as number]?.node.openingElement.loc.start.line).toBe(12);
  });

  it("moves an element into another parent", () => {
    const out = applyMove(code, at(11, 8), at(6, 4), 0);
    const els = collectElements(parseTsx(out.code));
    const main = els[0]?.node;
    const firstChild = main?.children.find((c) => c.type === "JSXElement");
    expect(out.code).toMatch(/<main[^>]*>\s*<p>Text<\/p>\s*<Card>/);
    expect(firstChild).toBeDefined();
    expect(out.trackIndex).not.toBeNull();
  });

  it("inserts with imports", () => {
    const out = applyInsert(code, at(7, 6), 0, `<Badge>New</Badge>`, [
      { name: "Badge", from: "@ds/badge" },
      { name: "Card", from: "@ds/card" },
    ]);
    expect(out.code).toContain(`import { Badge } from "@ds/badge";`);
    expect(out.code.match(/import \{ Card \}/g)?.length).toBe(1);
    expect(out.code).toMatch(/<Card>\s*<Badge>New<\/Badge>\s*<Button/);
    const els = collectElements(parseTsx(out.code));
    expect(els[out.trackIndex as number]?.node.openingElement.name).toMatchObject({
      name: "Badge",
    });
  });
});
