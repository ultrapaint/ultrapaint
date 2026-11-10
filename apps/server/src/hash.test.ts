import { assert, describe, it } from "@effect/vitest";
import { inEnglish, sortedByKey, stableJson } from "./hash.ts";

// Keys the committed files and the hashed designs hold, in the order they are written.
// Lithuanian has `y` before `x`, Estonian `zIndex` before `text`, and Danish `aalborg` last.
const IN_ORDER = [
  "aalborg",
  "c_10",
  "c_2",
  "frame_1",
  "frame-1",
  "frame1",
  "id",
  "kind",
  "role",
  "text",
  "type",
  "width",
  "x",
  "X",
  "y",
  "Y",
  "zIndex",
];

describe("the order of keys", () => {
  it("is English's, whatever the machine's language", () => {
    assert.deepStrictEqual([...IN_ORDER].reverse().sort(inEnglish), IN_ORDER);
  });

  it("is the same for a record whatever order it was built in", () => {
    const record = Object.fromEntries(
      [...IN_ORDER].reverse().map((key) => [key, key.length])
    );
    assert.deepStrictEqual(Object.keys(sortedByKey(record)), IN_ORDER);
  });

  it("is the same at every depth of what is hashed", () => {
    assert.strictEqual(
      stableJson(
        JSON.parse('{"zIndex":1,"y":2,"x":[{"y":3,"text":"a","x":4}],"text":5}')
      ),
      '{"text":5,"x":[{"text":"a","x":4,"y":3}],"y":2,"zIndex":1}'
    );
  });
});
