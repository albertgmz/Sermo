/**
 * Permission coverage: every operation and every exported service function that takes an actor
 * must reach the permission check (src/permissions) or be explicitly marked public; every
 * registered permission must be checked somewhere; and services must not decide with groups,
 * roles or legacy flags directly.
 *
 * The analysis is static: each source file is transpiled with Bun's transpiler and parsed with
 * acorn, then calls are followed across files through their imports. Only a call counts:
 * naming a check function (or a helper that reaches one) without calling it decides nothing.
 * `.can(...)` and `.value(...)` count only on an object that came from `permissionsOf(...)`,
 * directly, through a local variable, or through a parameter a caller passed it in.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import * as acorn from "acorn";
import * as walk from "acorn-walk";
import { PERMISSION_IDS, PERMISSIONS, type PermissionDefinition } from "./permissions/registry";

/**
 * Modules whose operations are not implemented yet. A module's worker removes its name when its
 * checks land; the list must end empty.
 */
const PENDING_MODULES = new Set<string>();

/**
 * Registered permissions whose feature is still being built. A feature's worker removes its
 * permissions from this list when the checks land; the list must end empty.
 */
const PENDING_PERMISSIONS = new Set<string>([]);

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
  /** Bindings called from its body ("file#name"). */
  refs: Set<string>;
  /** Direct check calls in its body. */
  checks: boolean;
  /** Calls with string literal arguments: [callee key or check name, literals]. */
  literalCalls: [string, string[]][];
  /** Its parameter names by position (null for a destructured one). */
  params: (string | null)[];
  /** Parameters of the functions declared inside it, by function name. */
  localParams: Map<string, (string | null)[]>;
  /** Names in its body that hold a `permissionsOf(...)` result. */
  holders: Set<string>;
  /**
   * Arguments that may hand such a result on: [callee key, or `local:<name>` for a function
   * declared inside it; position; the variable passed, or null for a `permissionsOf(...)` call].
   */
  passes: [string, number, string | null][];
  /** `.can(...)` / `.value(...)` calls on a named object: [object name, literals]. */
  memberCalls: [string, string[]][];
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

function resolveImport(from: string, spec: string, sources: Map<string, string>): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec);
  for (const candidate of [`${base}.ts`, join(base, "index.ts")])
    try {
      if (sources.has(candidate)) return candidate;
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
function paramNames(node: AnyNode | undefined): (string | null)[] {
  if (!isFunction(node)) return [];
  return (node!.params as AnyNode[]).map((p) => {
    const id = p.type === "AssignmentPattern" ? (p.left as AnyNode) : p;
    return id.type === "Identifier" ? (id.name as string) : null;
  });
}
const takesActor = (node: AnyNode | undefined) => paramNames(node).includes("actor");
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

/**
 * The strings an argument can evaluate to: a literal, either branch of a conditional or logical
 * expression, or a local variable initialized that way.
 */
function stringLeaves(node: AnyNode, locals: Map<string, string[]>): string[] {
  if (node.type === "Literal") return typeof node.value === "string" ? [node.value] : [];
  if (node.type === "ConditionalExpression")
    return [
      ...stringLeaves(node.consequent as AnyNode, locals),
      ...stringLeaves(node.alternate as AnyNode, locals),
    ];
  if (node.type === "LogicalExpression")
    return [
      ...stringLeaves(node.left as AnyNode, locals),
      ...stringLeaves(node.right as AnyNode, locals),
    ];
  if (node.type === "Identifier") return locals.get(node.name as string) ?? [];
  return [];
}

/** The services, the permission engine and the shared helpers, by absolute path. */
function readSources(): Map<string, string> {
  const files = [
    ...sourceFiles(join(SRC, "modules")),
    ...sourceFiles(join(SRC, "permissions")),
    ...sourceFiles(join(SRC, "shared")),
  ];
  return new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
}

function analyze(sources: Map<string, string> = readSources()) {
  const bindings = new Map<string, Binding>();
  const imports = new Map<string, Map<string, { file: string | null; name: string }>>();
  const legacyUses: string[] = [];
  for (const [file, source] of sources) {
    const code = transpiler.transformSync(source);
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
        const target = resolveImport(file, (statement.source as AnyNode).value as string, sources);
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
        params: paramNames(fn),
        localParams: new Map(),
        holders: new Set(),
        passes: [],
        memberCalls: [],
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
    /** The check function a call invokes (imported from src/permissions), or null. */
    const checkCalled = (node: AnyNode | undefined): string | null => {
      if (node?.type !== "CallExpression") return null;
      const callee = node.callee as AnyNode;
      if (callee.type !== "Identifier") return null;
      const imported = local.get(callee.name as string);
      return imported?.file?.includes(join(SRC, "permissions")) && CHECKS.has(imported.name)
        ? imported.name
        : null;
    };
    for (const [name, node, init] of decls) {
      const binding = bindings.get(key(file, name))!;
      // A handler given by name (`implement(contract, run)`) is called by the operation.
      if (binding.isOperation || binding.isPublic) {
        const handler = (init!.arguments as AnyNode[])[1];
        const ref = handler?.type === "Identifier" ? target(handler.name as string) : null;
        if (ref) binding.refs.add(ref);
      }
      // String literals a local variable can hold (`const id = cond ? "a.b" : "c.d"`).
      const locals = new Map<string, string[]>();
      walk.full(node as acorn.Node, (n) => {
        const any = n as AnyNode;
        if (any.type === "FunctionDeclaration" && any !== node && any.id)
          binding.localParams.set((any.id as AnyNode).name as string, paramNames(any));
        if (
          any.type === "VariableDeclarator" &&
          (any.id as AnyNode).type === "Identifier" &&
          any.init
        ) {
          // Block-scoped variables can share a name within one function: keep every value.
          const local = (any.id as AnyNode).name as string;
          locals.set(local, [
            ...(locals.get(local) ?? []),
            ...stringLeaves(any.init as AnyNode, locals),
          ]);
          if (checkCalled(any.init as AnyNode) === "permissionsOf") binding.holders.add(local);
          if (any !== node && isFunction(any.init as AnyNode))
            binding.localParams.set(local, paramNames(any.init as AnyNode));
        }
      });
      walk.full(node as acorn.Node, (n) => {
        const any = n as AnyNode;
        if (any.type === "CallExpression") {
          const args = any.arguments as AnyNode[];
          const literals = args.flatMap((a) => stringLeaves(a, locals));
          const callee = any.callee as AnyNode;
          let calleeKey: string | null = null;
          if (callee.type === "Identifier") {
            const check = checkCalled(any);
            if (check) {
              calleeKey = `check:${check}`;
              // Resolving the actor decides nothing until `.can` / `.value` is called on it.
              if (check !== "permissionsOf") binding.checks = true;
              for (const id of IMPLIED[check] ?? []) literals.push(id);
            } else {
              calleeKey = target(callee.name as string);
              if (calleeKey && calleeKey !== key(file, name)) binding.refs.add(calleeKey);
              args.forEach((arg, index) => {
                const passed =
                  checkCalled(arg) === "permissionsOf"
                    ? null
                    : arg.type === "Identifier"
                      ? (arg.name as string)
                      : undefined;
                if (passed !== undefined)
                  binding.passes.push([calleeKey ?? `local:${callee.name}`, index, passed]);
              });
            }
          } else if (
            callee.type === "MemberExpression" &&
            !callee.computed &&
            ["can", "value"].includes(((callee.property as AnyNode).name as string) ?? "")
          ) {
            const object = callee.object as AnyNode;
            if (checkCalled(object) === "permissionsOf") {
              calleeKey = "check:member";
              binding.checks = true;
            } else if (object.type === "Identifier")
              binding.memberCalls.push([object.name as string, literals]);
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

  // Follow each `permissionsOf(...)` result into the helpers it is passed to, until nothing new
  // is found; then `.can` / `.value` on a name that holds one is a check.
  for (let changed = true; changed; ) {
    changed = false;
    for (const b of bindings.values())
      for (const [callee, index, passed] of b.passes) {
        if (passed !== null && !b.holders.has(passed)) continue;
        const inner = callee.startsWith("local:");
        const receiver = inner ? b : bindings.get(callee);
        const param = (inner ? b.localParams.get(callee.slice(6)) : receiver?.params)?.[index];
        if (!receiver || !param || receiver.holders.has(param)) continue;
        receiver.holders.add(param);
        changed = true;
      }
  }
  for (const b of bindings.values())
    for (const [object, literals] of b.memberCalls) {
      if (!b.holders.has(object)) continue;
      b.checks = true;
      if (literals.length > 0) b.literalCalls.push(["check:member", literals]);
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

type Analysis = ReturnType<typeof analyze>;

/** Operations and exported actor-taking service functions that reach no check. */
function uncheckedFunctions({ bindings, reaches }: Analysis): string[] {
  const missing: string[] = [];
  for (const [k, b] of bindings) {
    const module = moduleOf(b.file);
    if (!module || PENDING_MODULES.has(module)) continue;
    if (!b.isOperation && !(b.exported && b.takesActor)) continue;
    if (b.isPublic || reaches(k)) continue;
    missing.push(`${relative(SRC, b.file)}: ${b.name}`);
  }
  return missing;
}

/** Permission ids passed as literals to a check, or to a helper that reaches one. */
function checkedPermissions({ bindings, reaches }: Analysis): Set<string> {
  const checked = new Set<string>();
  for (const b of bindings.values())
    for (const [callee, literals] of b.literalCalls)
      if (callee.startsWith("check:") || reaches(callee))
        for (const literal of literals) checked.add(literal);
  for (const id of [...checked]) {
    const def = PERMISSIONS[id as keyof typeof PERMISSIONS] as PermissionDefinition | undefined;
    if (def?.type === "flag" && def.timeLimit) checked.add(def.timeLimit);
  }
  return checked;
}

describe("permission coverage", () => {
  const analysis = analyze();
  const { bindings, legacyUses } = analysis;

  test("every operation and exported actor-taking service function checks permissions or is public", () => {
    expect(uncheckedFunctions(analysis)).toEqual([]);
  });

  test("converted modules decide only through the permission check", () => {
    const uses = legacyUses.filter((use) => {
      const module = use.split(/[\\/]/)[1];
      return use.startsWith("modules") && !PENDING_MODULES.has(module!);
    });
    expect(uses).toEqual([]);
  });

  test("every registered permission is checked somewhere", () => {
    const checked = checkedPermissions(analysis);
    const unchecked = PERMISSION_IDS.filter(
      (id) => !checked.has(id) && !PENDING_PERMISSIONS.has(id),
    );
    for (const id of PENDING_PERMISSIONS) expect(PERMISSION_IDS).toContain(id as never);
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

describe("the analyzer itself", () => {
  const file = (name: string) => join(SRC, "modules", "sample", `${name}.ts`);
  const HEADER = `
    import { implement, markPublic } from "../../operation";
    import { can, permissionsOf, requirePermission } from "../../permissions";
    import { mayRead, viaHelper } from "./helpers";
  `;
  const HELPERS = `
    import { requirePermission } from "../../permissions";
    export const viaHelper = (ctx, actor) => requirePermission(ctx, actor, "forum.reply", {});
    export const mayRead = (grants, nodeId) => grants.can("node.view", { nodeId });
    export const idle = (ctx) => ctx.now();
  `;
  const sample = (body: string) =>
    analyze(
      new Map([
        [file("index"), HEADER + body],
        [file("helpers"), HELPERS],
      ]),
    );
  const unchecked = (body: string) =>
    uncheckedFunctions(sample(body)).map((entry) => entry.split(": ")[1]);

  test("a check function that is named but never called is not a check", () => {
    expect(
      unchecked(`
        export const referencedOp = implement(contract, (ctx, actor) =>
          requirePermission && { items: [] });
        export const helperReferencedOp = implement(contract, (ctx, actor) =>
          viaHelper && { items: [] });
        export function passedAlong(ctx, actor) { return [can, permissionsOf].length; }
        export const resolvedOnlyOp = implement(contract, (ctx, actor) => {
          permissionsOf(ctx, actor);
          return {};
        });
      `),
    ).toEqual(["referencedOp", "helperReferencedOp", "passedAlong", "resolvedOnlyOp"]);
  });

  test(".can and .value on an object that is not a permissionsOf result are not checks", () => {
    const analysis = sample(`
      export const foreignOp = implement(contract, (ctx, actor, input) => ({
        allowed: input.policy.can("forum.createThread"),
        quota: ctx.cache.value("attachment.storageQuota"),
        other: actor.can("forum.editAny"),
      }));
      export function shadow(ctx, actor, grants) { return grants.can("forum.deleteAny", {}); }
    `);
    expect(uncheckedFunctions(analysis).map((entry) => entry.split(": ")[1])).toEqual([
      "foreignOp",
      "shadow",
    ]);
    expect([...checkedPermissions(analysis)]).toEqual(["forum.reply"]);
  });

  test("calls of the checks, of helpers that reach them and of permissionsOf results count", () => {
    const analysis = sample(`
      const run = (ctx, actor) => { requirePermission(ctx, actor, "admin.groups"); return {}; };
      export const directOp = implement(contract, (ctx, actor) => can(ctx, actor, "search.use"));
      export const helperOp = implement(contract, (ctx, actor) => viaHelper(ctx, actor));
      export const namedOp = implement(contract, run);
      export const localOp = implement(contract, (ctx, actor) => {
        const grants = permissionsOf(ctx, actor);
        return { edit: grants.can("forum.editAny", {}), quota: grants.value("attachment.storageQuota") };
      });
      export const inlineOp = implement(contract, (ctx, actor) =>
        permissionsOf(ctx, actor).can("forum.deleteAny", {}));
      export const passedOp = implement(contract, (ctx, actor, input) => {
        const grants = permissionsOf(ctx, actor);
        const visible = (held, row) => held.can("forum.viewDeleted", { nodeId: row.nodeId });
        return input.rows.filter((row) => mayRead(grants, row.nodeId) && visible(grants, row));
      });
      export const openOp = implement(contract, (ctx, actor) => ({}), { public: "open to all" });
      export const wrapped = markPublic("callers decide", (ctx, actor) => ({}));
    `);
    expect(uncheckedFunctions(analysis)).toEqual([]);
    expect([...checkedPermissions(analysis)].sort()).toEqual([
      "admin.groups",
      "attachment.storageQuota",
      "forum.deleteAny",
      "forum.editAny",
      "forum.reply",
      "forum.viewDeleted",
      "node.view",
      "search.use",
    ]);
  });
});
