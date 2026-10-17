import { expect, test } from "bun:test";
import ts from "typescript";
import { parseSource, read, sourceFiles, visit } from "./lite-scan";

// Every page is served with a Content-Security-Policy whose scripts must carry the request's nonce
// (src/lib/security-headers.ts). A script element drawn without one is refused by the browser, so
// each `<script>` and next/script `<Script>` in the source names `nonce`.
function scriptsWithoutNonce(path: string, source: string) {
  const tree = parseSource(path, source);
  const misses: number[] = [];
  visit(tree, (node) => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : undefined;
    if (!opening) return;
    const tag = opening.tagName.getText(tree);
    if (tag !== "script" && tag !== "Script") return;
    const named = opening.attributes.properties.some(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(tree) === "nonce",
    );
    if (!named)
      misses.push(
        tree.getLineAndCharacterOfPosition(opening.getStart(tree)).line + 1,
      );
  });
  return misses;
}

test("every script element in the source carries the nonce", () => {
  const misses = sourceFiles()
    .filter((path) => path.endsWith(".tsx"))
    .flatMap((path) =>
      scriptsWithoutNonce(path, read(path)).map((line) => `${path}:${line}`),
    );
  expect(misses).toEqual([]);
});

test("the scan finds a script without a nonce", () => {
  const source = [
    "export const A = () => <script dangerouslySetInnerHTML={{ __html: '' }} />;",
    "export const B = () => <Script id='b'>{code}</Script>;",
    "export const C = () => <script nonce={nonce} />;",
  ].join("\n");
  expect(scriptsWithoutNonce("x.tsx", source)).toEqual([1, 2]);
});
