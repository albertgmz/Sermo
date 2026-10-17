import { expect, test } from "bun:test";
import ts from "typescript";
import { parseSource, read, sourceFiles, visit } from "./lite-scan";

// Every page is served with a Content-Security-Policy whose scripts must carry the request's nonce
// (src/lib/security-headers.ts). A script element drawn without one is refused by the browser, so
// each `<script>`, next/script `<Script>` and wrapper of it (`<AnalyticsScript>`) in the source
// names `nonce`.
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
    if (!/^(?:script|\w*Script)$/.test(tag)) return;
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
    "export const D = () => <AnalyticsScript id='d' />;",
  ].join("\n");
  expect(scriptsWithoutNonce("x.tsx", source)).toEqual([1, 2, 4]);
});

// The nonce is read in the root layout, which is what makes every page render for its request: a
// shell prerendered at build time would carry no nonce, and the browser would run none of its
// scripts. Without the read (or without `instant = false`, which lets the layout block on it) the
// pages would build as static shells again and be dead in every browser, with nothing else failing.
test("the root layout reads the nonce and is allowed to block on it", () => {
  const layout = read("src/app/[locale]/layout.tsx");
  expect(layout).toMatch(/^export const instant = false;$/m);
  expect(layout).toMatch(/\bscriptNonce\(\)/);
  expect(layout.match(/<script\s+nonce=\{nonce\}/g)).toHaveLength(2);
});
