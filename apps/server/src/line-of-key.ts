/**
 * The line a dotted path of keys is written on (`colors.primary`, `shadow.card`), in a file of
 * YAML front matter or of JSON: each key looked for from where the one before it was found, as
 * `key:`, `"key":` or `'key':`. Where a key is not found, the line of the last one that was; with
 * none found, none. One-based, as an editor counts.
 */
export const lineOfKey = (text: string, at: string): number | undefined => {
  const lines = text.split("\n");
  let from = 0;
  let found: number | undefined;
  for (const key of at.split(".").filter((k) => k !== "")) {
    const written = new RegExp(
      `^\\s*(?:-\\s+)?(?:${escaped(key)}|"${escaped(key)}"|'${escaped(key)}')\\s*:`
    );
    const index = lines.findIndex((line, i) => i >= from && written.test(line));
    if (index === -1) {
      break;
    }
    found = index + 1;
    from = index + 1;
  }
  return found;
};

const SPECIAL = /[.*+?^${}()|[\]\\]/g;
const escaped = (key: string) => key.replace(SPECIAL, "\\$&");
