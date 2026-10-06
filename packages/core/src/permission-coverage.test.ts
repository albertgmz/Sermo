/**
 * Permission coverage: every operation and every exported service function that takes an actor
 * must reach the permission check (src/permissions) or be explicitly marked public; every
 * registered permission must be checked somewhere; and services must not decide with groups,
 * roles or legacy flags directly.
 *
 * The analysis is static: each source file is transpiled with Bun's transpiler and parsed with
 * acorn, then calls and references are followed across files through their imports.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { PERMISSION_IDS, PERMISSIONS, type PermissionDefinition } from "./permissions/registry";

/**
 * Modules not yet converted to the permission check. Converted modules are removed; the list
 * must end empty.
 */
const PENDING_MODULES = new Set<string>([
  "attachments",
  "auth",
  "conversations",
  "forums",
  "images",
  "moderation",
  "permissions",
  "reactions",
  "search",
  "seo",
  "settings",
  "storage",
]);

const SRC = import.meta.dir;
/** Functions of src/permissions that decide (calling one counts as checking). */
const CHECKS = new Set([
  "can",
  "requirePermission",
  "permissionValue",
  "permissionsOf",
  "viewableNodeIds",
  "resolvedPermissions",
  "explainPermission",
  "combinationsGranting",
]);
/** Permissions a check function decides by itself. */
const IMPLIED: Record<string, string[]> = { viewableNodeIds: ["node.view"] };
/**
 * Legacy helpers services may no longer use. (GROUP_IDS stays importable: assigning a built-in
 * group, as sign-up does, is not a permission decision.)
 */
const LEGACY_IMPORTS = new Set([
  "getNodeAccess",
  "getGlobalPermissions",
  "requireAdmin",
  "actorGroupId",
]);
const LEGACY_SQL =
  /\b(is_admin|is_moderator|can_view_nodes|can_post|can_view_profiles|can_post_profile|can_start_conversations|can_react|node_permissions)\b/;

type AnyNode = acorn.Node & Record<string, unknown>;
interface Binding {
  file: string;
  name: string;
  node: AnyNode;
  exported: boolean;
  /** Function taking a parameter named `actor`. */
  takesActor: boolean;
  isOperation: boolean;
  isPublic: boolean;
  /** Bindings referenced from its body ("file#name"). */
  refs: Set<string>;
  /** Direct check calls in its body. */
  checks: boolean;
  /** Calls with string literal arguments: [callee key or check name, literals]. */
  literalCalls: [string, string[]][];
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec);
  for (const candidate of [`${base}.ts`, join(base, "index.ts")])
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {}
  return null;
}

const transpiler = new Bun.Transpiler({ loader: "ts" });
const key = (file: string, name: string) => `${file}#${name}`;

function isFunction(node: AnyNode | undefined): boolean {
  return (
    !!node &&
    (node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression" ||
      node.type === "FunctionDeclaration")
  );
}
function takesActor(node: AnyNode | undefined): boolean {
  if (!isFunction(node)) return false;
  return (node!.params as AnyNode[]).some(
    (p) =>
      (p.type === "Identifier" && p.name === "actor") ||
      (p.type === "AssignmentPattern" && (p.left as AnyNode).name === "actor"),
  );
}
const calleeName = (call: AnyNode) => {
  const callee = call.callee as AnyNode;
  return callee.type === "Identifier" ? (callee.name as string) : null;
};
function publicOption(call: AnyNode): boolean {
  const options = (call.arguments as AnyNode[])[2];
  return (
    options?.type === "ObjectExpression" &&
    (options.properties as AnyNode[]).some(
      (p) => ((p.key as AnyNode)?.name ?? (p.key as AnyNode)?.value) === "public",
    )
  );
}

function analyze() {
  const files = [
    ...sourceFiles(join(SRC, "modules")),
    ...sourceFiles(join(SRC, "permissions")),
    ...sourceFiles(join(SRC, "shared")),
  ];
  const bindings = new Map<string, Binding>();
  const imports = new Map<string, Map<string, { file: string | null; name: string }>>();
  const legacyUses: string[] = [];
  for (const file of files) {
    const code = transpiler.transformSync(readFileSync(file, "utf8"));
    const program = acorn.parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
    }) as unknown as AnyNode;
    const local = new Map<string, { file: string | null; name: string }>();
    imports.set(file, local);
    const exportedNames = new Set<string>();
    const decls: [string, AnyNode, AnyNode | undefined][] = [];
    let anonymous = 0;
    for (const statement of program.body as AnyNode[]) {
      if (statement.type === "ImportDeclaration") {
        const target = resolveImport(file, (statement.source as AnyNode).value as string);
        for (const s of statement.specifiers as AnyNode[]) {
          const imported =
            s.type === "ImportSpecifier" ? ((s.imported as AnyNode).name as string) : "*";
          local.set((s.local as AnyNode).name as string, { file: target, name: imported });
          if (LEGACY_IMPORTS.has(imported))
            legacyUses.push(`${relative(SRC, file)} imports ${imported}`);
        }
        continue;
      }
      let declaration = statement;
      if (statement.type === "ExportNamedDeclaration") {
        if (statement.declaration) declaration = statement.declaration as AnyNode;
        for (const s of (statement.specifiers as AnyNode[]) ?? [])
          exportedNames.add((s.local as AnyNode).name as string);
        if (!statement.declaration) continue;
      }
      const exported = statement.type === "ExportNamedDeclaration";
      if (declaration.type === "FunctionDeclaration") {
        const name = (declaration.id as AnyNode).name as string;
        if (exported) exportedNames.add(name);
        decls.push([name, declaration, declaration]);
      } else if (declaration.type === "VariableDeclaration") {
        for (const d of declaration.declarations as AnyNode[]) {
          if ((d.id as AnyNode).type !== "Identifier") continue;
          const name = (d.id as AnyNode).name as string;
          if (exported) exportedNames.add(name);
          decls.push([name, d, d.init as AnyNode | undefined]);
          // implement(...) calls inside an exported array (operations = [implement(...), ...]).
          if ((d.init as AnyNode)?.type === "ArrayExpression")
            for (const element of ((d.init as AnyNode).elements as AnyNode[]) ?? [])
              if (element?.type === "CallExpression" && calleeName(element) === "implement")
                decls.push([`<operation ${++anonymous}>`, element, element]);
        }
      }
    }
    for (const [name, node, init] of decls) {
      const isOperation = init?.type === "CallExpression" && calleeName(init) === "implement";
      const isMarked = init?.type === "CallExpression" && calleeName(init) === "markPublic";
      const fn = isOperation || isMarked ? ((init!.arguments as AnyNode[])[1] as AnyNode) : init;
      const binding: Binding = {
        file,
        name,
        node,
        exported: exportedNames.has(name) || name.startsWith("<operation"),
        takesActor: takesActor(fn),
        isOperation,
        isPublic: isMarked || (isOperation && publicOption(init!)),
        refs: new Set(),
        checks: false,
        literalCalls: [],
      };
      bindings.set(key(file, name), binding);
    }
    // Second pass: references and calls inside each binding.
    const topLevel = new Set(decls.map(([name]) => name));
    const target = (name: string): string | null => {
      if (topLevel.has(name)) return key(file, name);
      const imported = local.get(name);
      if (imported?.file) return key(imported.file, imported.name);
      return null;
    };
    for (const [name, node] of decls) {
      const binding = bindings.get(key(file, name))!;
      walk.full(node as acorn.Node, (n) => {
        const any = n as AnyNode;
        if (any.type === "Identifier") {
          const ref = target(any.name as string);
          if (ref && ref !== key(file, name)) binding.refs.add(ref);
          const imported = local.get(any.name as string);
          if (imported?.file?.includes(`${join(SRC, "permissions")}`) && CHECKS.has(imported.name))
            binding.checks = true;
        }
        if (any.type === "CallExpression") {
          const literals = (any.arguments as AnyNode[])
            .filter((a) => a.type === "Literal" && typeof a.value === "string")
            .map((a) => a.value as string);
          const callee = any.callee as AnyNode;
          let calleeKey: string | null = null;
          if (callee.type === "Identifier") {
            const imported = local.get(callee.name as string);
            if (imported?.file?.includes(join(SRC, "permissions")) && CHECKS.has(imported.name)) {
              calleeKey = `check:${imported.name}`;
              for (const id of IMPLIED[imported.name] ?? []) literals.push(id);
            } else calleeKey = target(callee.name as string);
          } else if (
            callee.type === "MemberExpression" &&
            ["can", "value"].includes(((callee.property as AnyNode).name as string) ?? "")
          ) {
            calleeKey = "check:member";
            binding.checks = true;
          }
          if (calleeKey && literals.length > 0) binding.literalCalls.push([calleeKey, literals]);
        }
        if (any.type === "Literal" && typeof any.value === "string" && LEGACY_SQL.test(any.value))
          legacyUses.push(`${relative(SRC, file)} (${name}) uses legacy column in SQL`);
        if (
          any.type === "MemberExpression" &&
          (any.property as AnyNode).name === "groupId" &&
          ((any.object as AnyNode).name === "actor" || (any.object as AnyNode).name === "user")
        )
          legacyUses.push(`${relative(SRC, file)} (${name}) reads the actor's group`);
      });
    }
  }

  const memo = new Map<string, boolean>();
  const reaches = (k: string, seen = new Set<string>()): boolean => {
    if (k.startsWith("check:")) return true;
    const cached = memo.get(k);
    if (cached !== undefined) return cached;
    if (seen.has(k)) return false;
    seen.add(k);
    const b = bindings.get(k);
    const result = !!b && (b.checks || [...b.refs].some((ref) => reaches(ref, seen)));
    if (seen.size === 1 || result) memo.set(k, result);
    return result;
  };
  return { bindings, reaches, legacyUses };
}

const moduleOf = (file: string) => {
  const rel = relative(join(SRC, "modules"), file);
  return rel.startsWith("..") ? null : rel.split(/[\\/]/)[0]!;
};

describe("permission coverage", () => {
  const { bindings, reaches, legacyUses } = analyze();

  test("every operation and exported actor-taking service function checks permissions or is public", () => {
    const missing: string[] = [];
    for (const [k, b] of bindings) {
      const module = moduleOf(b.file);
      if (!module || PENDING_MODULES.has(module)) continue;
      if (!b.isOperation && !(b.exported && b.takesActor)) continue;
      if (b.isPublic || reaches(k)) continue;
      missing.push(`${relative(SRC, b.file)}: ${b.name}`);
    }
    expect(missing).toEqual([]);
  });

  test("converted modules decide only through the permission check", () => {
    const uses = legacyUses.filter((use) => {
      const module = use.split(/[\\/]/)[1];
      return use.startsWith("modules") && !PENDING_MODULES.has(module!);
    });
    expect(uses).toEqual([]);
  });

  test("every registered permission is checked somewhere", () => {
    const checked = new Set<string>();
    for (const b of bindings.values())
      for (const [callee, literals] of b.literalCalls)
        if (callee.startsWith("check:") || reaches(callee))
          for (const literal of literals) checked.add(literal);
    for (const id of [...checked]) {
      const def = PERMISSIONS[id as keyof typeof PERMISSIONS] as PermissionDefinition | undefined;
      if (def?.type === "flag" && def.timeLimit) checked.add(def.timeLimit);
    }
    const unchecked = PERMISSION_IDS.filter((id) => !checked.has(id));
    if (PENDING_MODULES.size > 0) return;
    expect(unchecked).toEqual([]);
  });

  test("the analysis sees the code it guards", () => {
    // A converted check must be found; the pending list must name real modules.
    const modules = new Set([...bindings.values()].map((b) => moduleOf(b.file)).filter(Boolean));
    for (const pending of PENDING_MODULES) expect(modules.has(pending)).toBe(true);
    const operations = [...bindings.values()].filter((b) => b.isOperation);
    expect(operations.length).toBeGreaterThan(80);
    expect([...bindings.values()].some((b) => moduleOf(b.file) && b.checks)).toBe(true);
  });
});
