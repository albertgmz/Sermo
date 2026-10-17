import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import ts from "typescript";
import { LITE_CATEGORIES } from "../src/lib/lite-preferences";

export const ROOT = resolve(import.meta.dirname, "..");

export function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

// A folder that does not exist holds nothing: `public` is not tracked once it has no files.
export function walk(directory: string): string[] {
  if (!existsSync(join(ROOT, directory))) return [];
  return readdirSync(join(ROOT, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? walk(path) : [path];
    })
    .sort();
}

// Read the actual classifier's extension list, but pin its contents in the tests.
const extensionSource = read("src/lib/lite-images.ts").match(
  /const IMAGE_EXTENSION\s*=\s*\/\\\.\(\?:([a-z|]+)\)\$\//,
);
if (!extensionSource)
  throw new Error(
    "Update tests/lite-scan.ts to read the proxy's image extensions.",
  );
export const IMAGE_EXTENSIONS = extensionSource[1].split("|");

export function publicImages(): string[] {
  return walk("public").filter((path) =>
    IMAGE_EXTENSIONS.includes(extname(path).slice(1).toLowerCase()),
  );
}

export type Hit = { line: number; kind: string };

const EMISSIONS: [string, RegExp][] = [
  ["image element", /<(?:img|Image|picture|source)\b/g],
  // A player fetches its file (at least its length) as soon as it is drawn.
  ["media element", /<(?:video|audio)\b/g],
  ["next/image", /["']next\/image["']/g],
  ["AvatarImage", /\bAvatarImage\b/g],
  ["image attribute", /\b(?:srcSet|srcset)\b|\bposter\s*=/g],
  ["background image", /\bbackgroundImage\b|\bbackground-image["']?\s*:/g],
  [
    "CSS image URL",
    /\b(?:background|mask(?:-image|-border)?|maskImage|border-image(?:-source)?|borderImage(?:Source)?|list-style(?:-image)?|listStyle(?:Image)?|cursor|content)["']?\s*[:=]\s*[^;{}]*?url\s*\(/gi,
  ],
  ["Tailwind image URL", /\[[^\]\r\n]*?url\s*\(/gi],
  [
    "image preload",
    /<link\b(?=[^>]*\brel\s*=\s*[{\s]*["']preload["'])(?=[^>]*\bas\s*=\s*[{\s]*["']image["'])[^>]*>/gi,
  ],
  [
    "site icon",
    /\brel\s*=\s*[{\s]*["'](?:icon|shortcut icon|apple-touch-icon)["']/gi,
  ],
  ["image metadata", /\b(?:icons|openGraph|twitter)["']?\s*:/g],
  ["Image constructor", /\bnew\s+Image\s*\(/g],
  ["SVG image", /<image\b|<use\b[^>]*\b(?:href|xlinkHref|xlink:href)\s*=/g],
];

// A path to a picture file on this site. Nothing in `public` is a picture any more (the backend
// serves them, addressed by id), so a source that names one is adding a file that no category
// owns and no gate checks.
const PICTURE_FILE = new RegExp(
  `^/[^\\s"']*\\.(?:${IMAGE_EXTENSIONS.join("|")})(?:[?#].*)?$`,
  "i",
);

export function parseSource(path: string, source: string) {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

export function visit(node: ts.Node, fn: (node: ts.Node) => void) {
  fn(node);
  node.forEachChild((child) => visit(child, fn));
}

function lineAt(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

export function emissionHits(path: string, source: string): Hit[] {
  const hits: Hit[] = [];
  for (const [kind, pattern] of EMISSIONS) {
    for (const match of source.matchAll(pattern))
      hits.push({ kind, line: lineAt(source, match.index) });
  }
  function picturePath(value: string, offset: number) {
    const pathname = value.replace(/^https?:\/\/[^/]+/, "");
    if (PICTURE_FILE.test(pathname))
      hits.push({ kind: "picture file path", line: lineAt(source, offset) });
  }
  if (path.endsWith(".css")) {
    for (const match of source.matchAll(/["']([^"'\r\n]*)["']/g))
      picturePath(match[1], match.index);
    return hits;
  }
  const tree = parseSource(path, source);
  visit(tree, (node) => {
    if (!ts.isStringLiteralLike(node) && !ts.isTemplateExpression(node)) return;
    const value = ts.isTemplateExpression(node)
      ? node.getText(tree).slice(1, -1)
      : node.text;
    picturePath(value, node.getStart(tree));
  });
  return hits;
}

export function artCategoryErrors(path: string, source: string): string[] {
  const tree = parseSource(path, source);
  const names = new Set(["Art"]);
  const namespaces = new Set<string>();
  visit(tree, (node) => {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      !/(?:^|\/)art$/.test(node.moduleSpecifier.text)
    )
      return;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings))
      namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings))
      for (const entry of bindings.elements)
        if ((entry.propertyName ?? entry.name).text === "Art")
          names.add(entry.name.text);
  });
  const errors: string[] = [];
  visit(tree, (node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))
      return;
    const tag = node.tagName.getText(tree);
    if (
      !names.has(tag) &&
      ![...namespaces].some((name) => tag === `${name}.Art`)
    )
      return;
    const attributes = node.attributes.properties;
    const category = attributes.find(
      (attr) =>
        ts.isJsxAttribute(attr) && attr.name.getText(tree) === "category",
    );
    function registered(node: ts.Node | undefined): boolean {
      if (!node) return false;
      if (ts.isStringLiteralLike(node))
        return LITE_CATEGORIES.some(({ key }) => key === node.text);
      if (ts.isConditionalExpression(node))
        return registered(node.whenTrue) && registered(node.whenFalse);
      if (ts.isParenthesizedExpression(node))
        return registered(node.expression);
      return false;
    }
    let valid = false;
    if (category && ts.isJsxAttribute(category)) {
      const initializer = category.initializer;
      valid = registered(
        initializer && ts.isJsxExpression(initializer)
          ? initializer.expression
          : initializer,
      );
    }
    const overridden =
      category &&
      attributes
        .slice(attributes.indexOf(category) + 1)
        .some(ts.isJsxSpreadAttribute);
    if (!valid || overridden)
      errors.push(
        `${path}:${lineAt(source, node.getStart(tree))}: <${tag}> must pass an explicit category from LITE_CATEGORIES after any spread; render the picture through a gate with a category.`,
      );
  });
  return errors;
}

export function sourceFiles() {
  // Test files never reach the browser; they name pictures as fixtures.
  return walk("src").filter(
    (path) => /\.(?:ts|tsx|css)$/.test(path) && !/\.test\.tsx?$/.test(path),
  );
}
