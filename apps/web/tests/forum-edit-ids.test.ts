import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const DIR = "src/app/[locale]/(staff)/admin/forums/[id]";

// The ids a source file writes out in full (not built from a template), with the label id every
// `FieldRow` derives from its `htmlFor`.
function fixedIds(file: string): string[] {
  const source = readFileSync(`${DIR}/${file}`, "utf8");
  const ids = [...source.matchAll(/\bid="([^"{]+)"/g)].map((m) => m[1]);
  const fields = [...source.matchAll(/htmlFor="([^"{]+)"/g)].map(
    (m) => `${m[1]}-label`,
  );
  return [...ids, ...fields];
}

test("the forum edit screen's forms do not share an id", () => {
  const node = new Set(fixedIds("node-form.tsx"));
  const pictures = fixedIds("pictures-form.tsx");
  const clash = pictures.filter((id) => node.has(id));
  expect(clash).toEqual([]);
});
