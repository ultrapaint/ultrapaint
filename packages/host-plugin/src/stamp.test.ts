import { describe, expect, it } from "vitest";
import { stampJsx } from "./stamp.ts";

describe("stampJsx", () => {
  it("stamps every element with file, line and column", () => {
    const code = `export default function A() {\n  return (\n    <div className="p-4">\n      <Button variant="ghost">Hi</Button>\n      <>\n        <p>text</p>\n      </>\n    </div>\n  );\n}\n`;
    const out = stampJsx(code, { file: "designs/a.tsx" });
    expect(out.count).toBe(3);
    expect(out.code).toContain(
      `<div data-ed="designs/a.tsx:3:4" className="p-4">`
    );
    expect(out.code).toContain(
      `<Button data-ed="designs/a.tsx:4:6" variant="ghost">`
    );
    expect(out.code).toContain(`<p data-ed="designs/a.tsx:6:8">text</p>`);
  });

  it("handles self-closing, member expressions and generics", () => {
    const code = `const x = <Foo.Bar<string> a={1} />;\nconst y = <img src="a" />;`;
    const out = stampJsx(code, { file: "f.tsx" });
    expect(out.code).toContain(
      `<Foo.Bar<string> data-ed="f.tsx:1:10" a={1} />`
    );
    expect(out.code).toContain(`<img data-ed="f.tsx:2:10" src="a" />`);
  });

  it("does not double stamp", () => {
    const code = `const x = <div data-ed="f.tsx:1:10" />;`;
    expect(stampJsx(code, { file: "f.tsx" }).count).toBe(0);
  });
});
