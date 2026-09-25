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
  extractElement,
  outlineOf,
  mergeClasses,
  parseTsx,
} from "./source.ts";

const MOVED_INTO_MAIN_RE = /<main[^>]*>\s*<p>Text<\/p>\s*<Card>/;
const INSERTED_BADGE_RE = /<Card>\s*<Badge>New<\/Badge>\s*<Button/;

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

const at = (line: number, col: number) => ({ col, file, line });

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
    expect(mergeClasses("flex p-4 text-sm", ["p-6"], [])).toBe(
      "flex text-sm p-6"
    );
    expect(mergeClasses("flex p-4", [], ["p-4"])).toBe("flex");
  });

  it("rewrites className in place", () => {
    const out = applySetClasses(code, at(6, 4), ["p-8"], []);
    expect(out.code).toContain(`<main className="flex flex-col gap-4 p-8">`);
    expect(out.code.split("\n").length).toBe(code.split("\n").length);
  });

  it("adds className alphabetically when missing", () => {
    const out = applySetClasses(code, at(8, 8), ["mt-2"], []);
    expect(out.code).toContain(
      `<Button className="mt-2" size="sm" variant="ghost">`
    );
  });

  it("sets, changes and removes attributes", () => {
    let out = applySetAttribute(code, at(8, 8), "variant", "outline").code;
    expect(out).toContain(`variant="outline"`);
    out = applySetAttribute(out, at(8, 8), "disabled", true).code;
    expect(out).toContain(`<Button disabled size="sm" variant="outline">`);
    out = applySetAttribute(out, at(8, 8), "size", null).code;
    expect(out).toContain(`<Button disabled variant="outline">`);
    out = applySetAttribute(out, at(8, 8), "count", 3).code;
    expect(out).toContain("count={3}");
  });

  it("sets text", () => {
    const out = applySetText(code, at(11, 8), "Changed {x}").code;
    expect(out).toContain(`<p>{"Changed {x}"}</p>`);
  });

  it("deletes and drops unused imports", () => {
    const out = applyDelete(code, at(8, 8)).code;
    expect(out).not.toContain("<Button");
    expect(out).not.toContain("import { Button }");
    expect(out).toContain("import { Card }");
  });

  it("duplicates after the element and tracks the copy", () => {
    const out = applyDuplicate(code, at(11, 8));
    expect(out.code.match(/<p>Text<\/p>/g)?.length).toBe(2);
    const els = collectElements(parseTsx(out.code));
    expect(
      els[out.trackIndex as number]?.node.openingElement.loc.start.line
    ).toBe(12);
  });

  it("moves an element into another parent", () => {
    const out = applyMove(code, at(11, 8), at(6, 4), 0);
    const els = collectElements(parseTsx(out.code));
    const main = els[0]?.node;
    const firstChild = main?.children.find((c) => c.type === "JSXElement");
    expect(out.code).toMatch(MOVED_INTO_MAIN_RE);
    expect(firstChild).toBeDefined();
    expect(out.trackIndex).not.toBeNull();
  });

  it("inserts with imports", () => {
    const out = applyInsert(code, at(7, 6), 0, "<Badge>New</Badge>", [
      { from: "@ds/badge", name: "Badge" },
      { from: "@ds/card", name: "Card" },
    ]);
    expect(out.code).toContain(`import { Badge } from "@ds/badge";`);
    expect(out.code.match(/import \{ Card \}/g)?.length).toBe(1);
    expect(out.code).toMatch(INSERTED_BADGE_RE);
    const els = collectElements(parseTsx(out.code));
    expect(
      els[out.trackIndex as number]?.node.openingElement.name
    ).toMatchObject({
      name: "Badge",
    });
  });

  it("inserts the helpers an element needs, once", () => {
    const helper = {
      code: "const Stat = () => <b>1</b>;",
      name: "Stat",
    };
    const out = applyInsert(code, at(7, 6), 0, "<Stat />", [], [helper]);
    expect(out.code).toContain(
      `import { Card } from "@ds/card";\n\nconst Stat = () => <b>1</b>;`
    );
    const els = collectElements(parseTsx(out.code));
    expect(
      els[out.trackIndex as number]?.node.openingElement.name
    ).toMatchObject({ name: "Stat" });
    const again = applyInsert(out.code, at(9, 6), 0, "<Stat />", [], [helper]);
    expect(again.code.match(/const Stat =/g)?.length).toBe(1);
  });

  it("adds aliased and namespace imports", () => {
    const out = applyInsert(code, at(7, 6), 0, "<Icons.Star />", [
      { from: "@ds/icons", isNamespace: true, name: "Icons" },
      { alias: "Action", from: "@ds/button", name: "Button" },
    ]);
    expect(out.code).toContain(`import * as Icons from "@ds/icons";`);
    expect(out.code).toContain("import { Button, Button as Action }");
  });
});

describe("extracting an element", () => {
  const page = `import { Card } from "@ds/card";
import { Button as Action } from "@ds/button";
import * as Icons from "@ds/icons";
import logo from "../assets/logo.png";
import { unused } from "./unused.ts";

const label = (n: number) => \`\${n} items\`;

export function Stat({ value }: { value: number }) {
  return <strong>{label(value)}</strong>;
}

export default function Home() {
  const [count] = useState(0);
  return (
    <main>
      <Card>
        <img src={logo} />
        <Icons.Star />
        <Action>{count}</Action>
        {[1, 2].map((n) => (
          <Stat key={n} value={n} />
        ))}
      </Card>
    </main>
  );
}
`;
  const pageFile = "designs/shop/home.tsx";

  it("carries imports, helpers and the names it cannot", () => {
    const out = extractElement(
      page,
      { col: 6, file: pageFile, line: 17 },
      "designs/shop/_canvas/card.tsx"
    );
    expect(out.name).toBe("Card");
    expect(out.jsx.startsWith("<Card>\n  <img")).toBe(true);
    expect(out.imports).toEqual([
      { from: "@ds/card", name: "Card" },
      { from: "../../assets/logo.png", isDefault: true, name: "logo" },
      { from: "@ds/icons", isNamespace: true, name: "Icons" },
      { alias: "Action", from: "@ds/button", name: "Button" },
    ]);
    expect(out.declarations.map((d) => d.name)).toEqual(["label", "Stat"]);
    expect(out.declarations[1]?.code.startsWith("function Stat")).toBe(true);
    expect(out.unresolved).toEqual(["count"]);
  });
});

describe("outlining a file", () => {
  it("tells a component's inside from what its instances are given", () => {
    const code = `const Stat = () => (
  <div>
    <p>1</p>
  </div>
);

export default function Home() {
  return (
    <main>
      <Stat />
      {[1].map((n) => <b key={n} />)}
    </main>
  );
}
`;
    const out = outlineOf(code);
    expect(out.map((e) => [e.line, e.parent, e.direct, e.scope])).toEqual([
      [2, null, false, "Stat"],
      [3, 0, true, "Stat"],
      [9, null, false, "default"],
      [10, 2, true, "default"],
      [11, 2, false, "default"],
    ]);
  });
});
