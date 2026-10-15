import ts from "typescript";
import {
  CATEGORIES,
  ownedBy,
  type Storage,
} from "../src/lib/consent/inventory";
import { parseSource, visit } from "./lite-scan";

// Finds every place the web app writes a name into the browser (a cookie `set`, a
// `localStorage` or `sessionStorage` `setItem`, an assignment to `document.cookie`, and a
// `storageKey` prop, which `CollapsiblePanel` stores under) and resolves the name to a string: a
// literal, a constant of the file or an exported constant of another. A name that is not in the
// inventory, or that cannot be resolved, is a problem. A name that cannot be resolved is let
// through only in the files below, each with the reason, and only when no literal is involved.
const PASS_THROUGH: Record<string, string> = {
  "src/lib/sermo/auth.ts":
    "Passes on the cookies the auth backend sets, by the names it chose; the session-name scan holds those.",
  "src/components/forum/collapsible-panel.tsx":
    "Stores under the `storageKey` prop, and every `storageKey` prop is scanned.",
};

const COOKIE_STORE =
  /(?:^|\.)(?:cookies|store|cookieStore)$|^\(await cookies\(\)\)$/;
const STORAGE = /(?:^|\.)(localStorage|sessionStorage)$/;

export type Scan = { checked: string[]; problems: string[] };

// The exported string constants of the source files, by name (`LITE_COOKIE`, ...).
export function exportedStrings(files: Record<string, string>) {
  const found = new Map<string, string>();
  for (const [path, source] of Object.entries(files)) {
    const file = parseSource(path, source);
    for (const statement of file.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      if (
        !statement.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.ExportKeyword,
        )
      )
        continue;
      for (const declaration of statement.declarationList.declarations) {
        const value =
          ts.isIdentifier(declaration.name) && declaration.initializer
            ? literalText(declaration.initializer)
            : undefined;
        if (value !== undefined && ts.isIdentifier(declaration.name))
          found.set(declaration.name.text, value);
      }
    }
  }
  return found;
}

const literalText = (node: ts.Expression): string | undefined =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;

export function scanSource(
  path: string,
  source: string,
  globals: Map<string, string>,
): Scan {
  const file = parseSource(path, source);
  const locals = new Map<string, string>();

  // The text an expression stands for, or undefined. A hole in a template that is not a known
  // constant stands for "1" (an id, a label): it is the prefix that must be in the inventory.
  const evaluate = (
    node: ts.Expression,
    holes: boolean,
  ): string | undefined => {
    const text = literalText(node);
    if (text !== undefined) return text;
    if (ts.isParenthesizedExpression(node))
      return evaluate(node.expression, holes);
    if (ts.isIdentifier(node))
      return locals.get(node.text) ?? globals.get(node.text);
    if (ts.isTemplateExpression(node)) {
      let out = node.head.text;
      for (const span of node.templateSpans) {
        const value =
          evaluate(span.expression, false) ?? (holes ? "1" : undefined);
        if (value === undefined) return undefined;
        out += value + span.literal.text;
      }
      return out;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = evaluate(node.left, holes);
      const right = evaluate(node.right, holes);
      return left === undefined || right === undefined
        ? undefined
        : left + right;
    }
    return undefined;
  };

  visit(file, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const value = evaluate(node.initializer, false);
      if (value !== undefined) locals.set(node.name.text, value);
    }
  });

  const checked: string[] = [];
  const problems: string[] = [];
  const at = (node: ts.Node) =>
    `${path}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  function check(node: ts.Node, name: string | undefined, storage: Storage) {
    if (name === undefined) {
      if (PASS_THROUGH[path] && !hasLiteralName(node)) {
        checked.push(`${path} (passed through)`);
      } else {
        problems.push(
          `${at(node)}: the name written to ${storage} cannot be resolved`,
        );
      }
      return;
    }
    checked.push(`${path} ${name}`);
    if (!CATEGORIES.some((category) => ownedBy(category, name, storage)))
      problems.push(
        `${at(node)}: "${name}" is not in the ${storage} inventory`,
      );
  }

  const hasLiteralName = (call: ts.Node) =>
    ts.isCallExpression(call) &&
    call.arguments[0] !== undefined &&
    literalText(call.arguments[0] as ts.Expression) !== undefined;

  visit(file, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const receiver = node.expression.expression
        .getText(file)
        .replace(/\?$/, "");
      const method = node.expression.name.text;
      const [first] = node.arguments;
      // A cookie write is known by its receiver, or by its shape whatever the receiver is
      // (`jar.set(name, value, { path })`, `jar.set({ name, value })`).
      if (
        method === "set" &&
        first &&
        (COOKIE_STORE.test(receiver) || hasCookieShape(node.arguments))
      ) {
        const name = ts.isObjectLiteralExpression(first)
          ? objectName(first, evaluate)
          : evaluate(first, false);
        check(node, name, "cookie");
      }
      if (
        (method === "append" || method === "set") &&
        first &&
        literalText(first as ts.Expression)?.toLowerCase() === "set-cookie"
      ) {
        const header = node.arguments[1] && evaluate(node.arguments[1], true);
        check(node, header?.split("=")[0]?.trim(), "cookie");
      }
      const storage = STORAGE.exec(receiver)?.[1] as Storage | undefined;
      if (method === "setItem" && storage && first)
        check(node, evaluate(first, true), storage);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText(file) === "document.cookie"
    ) {
      const value = evaluate(node.right, true);
      check(node, value?.split("=")[0]?.trim(), "cookie");
    }
    // `localStorage.key = value` and `localStorage["key"] = value`.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const { left } = node;
      const target =
        ts.isPropertyAccessExpression(left) ||
        ts.isElementAccessExpression(left)
          ? left
          : undefined;
      const storage =
        target && STORAGE.exec(target.expression.getText(file))?.[1];
      if (target && storage) {
        const name = ts.isPropertyAccessExpression(target)
          ? target.name.text
          : evaluate(target.argumentExpression, true);
        check(node, name, storage as Storage);
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(file) === "storageKey" &&
      node.initializer
    ) {
      const value = ts.isStringLiteral(node.initializer)
        ? node.initializer.text
        : ts.isJsxExpression(node.initializer) && node.initializer.expression
          ? evaluate(node.initializer.expression, true)
          : undefined;
      check(node, value, "localStorage");
    }
  });
  return { checked, problems };
}

const COOKIE_OPTIONS = new Set([
  "path",
  "maxAge",
  "httpOnly",
  "sameSite",
  "secure",
  "expires",
  "domain",
]);

// Whether the arguments of a `.set(` look like a cookie write: `(name, value, { path | maxAge | ... })`
// or `({ name, value, ... })`.
function hasCookieShape(args: ts.NodeArray<ts.Expression>) {
  const keys = (node: ts.Expression | undefined) =>
    node && ts.isObjectLiteralExpression(node)
      ? node.properties.flatMap((property) =>
          property.name ? [property.name.getText()] : [],
        )
      : [];
  if (keys(args[2]).some((key) => COOKIE_OPTIONS.has(key))) return true;
  const own = keys(args[0]);
  return own.includes("name") && own.includes("value");
}

function objectName(
  object: ts.ObjectLiteralExpression,
  evaluate: (node: ts.Expression, holes: boolean) => string | undefined,
) {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === "name")
      return evaluate(property.initializer, false);
  }
  return undefined;
}
