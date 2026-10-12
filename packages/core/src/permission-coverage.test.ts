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
 * directly, through a local variable, or through a parameter a caller passed it in. Nested
 * functions are visited only when called, including callbacks reached through inspected local
 * helpers or the explicitly recognized transaction and collection APIs below. Bindings resolve
 * lexically, so a parameter or local declaration cannot impersonate an imported check.
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
  /** Checks reached through calls from this binding, with lexical arguments preserved. */
  checks: boolean;
  permissions: Set<string>;
}

interface Scope {
  parent?: Scope;
  functionScope: boolean;
  names: Map<string, LexicalBinding>;
}
interface LexicalBinding {
  init?: AnyNode;
  imported?: { file: string | null; name: string };
  reassigned?: boolean;
}
type Value =
  | { kind: "function"; node: AnyNode; env: Environment }
  | { kind: "import"; file: string | null; name: string }
  | { kind: "permissions" }
  | { kind: "strings"; strings: string[] }
  | { kind: "object" }
  | { kind: "array"; length: number; populated: number }
  | { kind: "factoryResult" }
  | undefined;
type Environment = Map<LexicalBinding, Value>;

/** Acorn produces plain ESTree nodes without parent links. */
function children(node: AnyNode): AnyNode[] {
  return Object.values(node).flatMap((value) => {
    const values = Array.isArray(value) ? value : [value];
    return values.filter(
      (child): child is AnyNode =>
        child !== null && typeof child === "object" && typeof child.type === "string",
    );
  });
}

function patternNames(pattern: AnyNode): AnyNode[] {
  if (pattern.type === "Identifier") return [pattern];
  if (pattern.type === "AssignmentPattern") return patternNames(pattern.left as AnyNode);
  if (pattern.type === "RestElement") return patternNames(pattern.argument as AnyNode);
  if (pattern.type === "ObjectPattern")
    return (pattern.properties as AnyNode[]).flatMap((property) =>
      patternNames((property.value ?? property.argument) as AnyNode),
    );
  if (pattern.type === "ArrayPattern")
    return (pattern.elements as (AnyNode | null)[]).flatMap((item) =>
      item ? patternNames(item) : [],
    );
  return [];
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
  const scopes = new Map<AnyNode, Scope>();
  const modules = new Map<string, Scope>();
  const handlers = new Map<Binding, AnyNode>();
  const legacyUses: string[] = [];
  const lookup = (node: AnyNode): LexicalBinding | undefined => {
    for (let scope = scopes.get(node); scope; scope = scope.parent) {
      const found = scope.names.get(node.name as string);
      if (found) return found;
    }
  };
  const declare = (scope: Scope, pattern: AnyNode, init?: AnyNode) => {
    for (const id of patternNames(pattern)) {
      scope.names.set(id.name as string, {
        init: pattern.type === "Identifier" ? init : undefined,
      });
    }
  };

  for (const [file, source] of sources) {
    const program = acorn.parse(transpiler.transformSync(source), {
      ecmaVersion: "latest",
      sourceType: "module",
    }) as unknown as AnyNode;
    const module: Scope = { functionScope: true, names: new Map() };
    modules.set(file, module);
    // Build all declarations before resolving references: hoisted declarations, parameters,
    // catch bindings and block/loop bindings must hide outer imports even before their use.
    const collect = (node: AnyNode, enclosing: Scope) => {
      if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration")
        declare(enclosing, node.id as AnyNode, node);
      let scope = enclosing;
      if (
        isFunction(node) ||
        [
          "BlockStatement",
          "ForStatement",
          "ForInStatement",
          "ForOfStatement",
          "SwitchStatement",
          "CatchClause",
          "ClassExpression",
          "ClassDeclaration",
        ].includes(node.type)
      ) {
        scope = { parent: enclosing, functionScope: isFunction(node), names: new Map() };
      }
      scopes.set(node, scope);
      if (isFunction(node)) {
        for (const param of node.params as AnyNode[]) declare(scope, param);
        if (node.type === "FunctionExpression" && node.id) declare(scope, node.id as AnyNode, node);
      }
      if (node.type === "CatchClause" && node.param) declare(scope, node.param as AnyNode);
      if (node.type === "ImportDeclaration") {
        const target = resolveImport(file, (node.source as AnyNode).value as string, sources);
        for (const spec of node.specifiers as AnyNode[]) {
          const name =
            spec.type === "ImportSpecifier" ? ((spec.imported as AnyNode).name as string) : "*";
          scope.names.set((spec.local as AnyNode).name as string, {
            imported: { file: target, name },
          });
          if (LEGACY_IMPORTS.has(name)) legacyUses.push(`${relative(SRC, file)} imports ${name}`);
        }
      }
      if (node.type === "VariableDeclaration") {
        let owner = scope;
        if (node.kind === "var") while (!owner.functionScope && owner.parent) owner = owner.parent;
        for (const declaration of node.declarations as AnyNode[])
          declare(owner, declaration.id as AnyNode, declaration.init as AnyNode | undefined);
      }
      for (const child of children(node)) collect(child, scope);
    };
    collect(program, module);
    // Mutable aliases are not proof: even an assignment on an unvisited path invalidates one.
    walk.full(program as acorn.Node, (node) => {
      const any = node as AnyNode;
      if (any.type === "AssignmentExpression" || any.type === "UpdateExpression")
        for (const id of patternNames((any.left ?? any.argument) as AnyNode)) {
          const binding = lookup(id);
          if (binding) binding.reassigned = true;
        }
      if (any.type === "Literal" && typeof any.value === "string" && LEGACY_SQL.test(any.value))
        legacyUses.push(`${relative(SRC, file)} uses legacy column in SQL`);
      if (
        any.type === "MemberExpression" &&
        (any.property as AnyNode).name === "groupId" &&
        ["actor", "user"].includes((any.object as AnyNode).name as string)
      )
        legacyUses.push(`${relative(SRC, file)} reads the actor's group`);
    });
    const exported = new Set<string>();
    const decls: [string, AnyNode, AnyNode | undefined][] = [];
    let anonymous = 0;
    for (const statement of program.body as AnyNode[]) {
      const declaration = (statement.declaration ?? statement) as AnyNode;
      const isExport = statement.type === "ExportNamedDeclaration";
      for (const spec of (statement.specifiers as AnyNode[]) ?? [])
        if (isExport) exported.add((spec.local as AnyNode).name as string);
      if (declaration.type === "FunctionDeclaration") {
        const name = (declaration.id as AnyNode).name as string;
        if (isExport) exported.add(name);
        decls.push([name, declaration, declaration]);
      } else if (declaration.type === "VariableDeclaration") {
        for (const node of declaration.declarations as AnyNode[]) {
          if ((node.id as AnyNode).type !== "Identifier") continue;
          const name = (node.id as AnyNode).name as string;
          if (isExport) exported.add(name);
          const init = node.init as AnyNode | undefined;
          decls.push([name, node, init]);
          if (init?.type === "ArrayExpression")
            for (const element of init.elements as AnyNode[])
              if (element?.type === "CallExpression" && calleeName(element) === "implement")
                decls.push([`<operation ${++anonymous}>`, element, element]);
        }
      }
    }
    // Methods returned by an exported factory are service entry points of their own. A check
    // in createStorage(...).upload must cover upload, never the enclosing factory/operation.
    for (const [name, , init] of [...decls]) {
      if (!exported.has(name) || !isFunction(init)) continue;
      const returnedMethods = (node: AnyNode) => {
        if (isFunction(node)) return;
        if (
          node.type === "ReturnStatement" &&
          (node.argument as AnyNode)?.type === "ObjectExpression"
        ) {
          for (const property of (node.argument as AnyNode).properties as AnyNode[]) {
            const method = property.value as AnyNode;
            if (!isFunction(method) || property.kind !== "init" || property.computed) continue;
            const methodName = `${name}.${(property.key as AnyNode).name ?? (property.key as AnyNode).value}`;
            exported.add(methodName);
            decls.push([methodName, method, method]);
          }
        }
        for (const child of children(node)) returnedMethods(child);
      };
      returnedMethods(init!.body as AnyNode);
    }
    for (const [name, node, init] of decls) {
      const isOperation = init?.type === "CallExpression" && calleeName(init) === "implement";
      const isMarked = init?.type === "CallExpression" && calleeName(init) === "markPublic";
      const handler = isOperation || isMarked ? (init!.arguments as AnyNode[])[1] : init;
      const binding: Binding = {
        file,
        name,
        node,
        exported: exported.has(name) || name.startsWith("<operation"),
        takesActor: takesActor(handler),
        isOperation,
        isPublic: isMarked || (isOperation && publicOption(init!)),
        checks: false,
        permissions: new Set(),
      };
      bindings.set(key(file, name), binding);
      if (handler) handlers.set(binding, handler);
    }
  }

  // These imported synchronous APIs invoke the indicated callback. Recognizing exact module
  // paths and imported names preserves aliases without trusting a shadowing local function.
  const callbackArgument = (value: Extract<Value, { kind: "import" }>): number | undefined => {
    if (value.file === join(SRC, "db", "tx.ts") && value.name === "writeTx") return 1;
    if (
      [join(SRC, "permissions", "index.ts"), join(SRC, "permissions", "check.ts")].includes(
        value.file ?? "",
      ) &&
      value.name === "readWithCurrentActor"
    )
      return 2;
  };
  const importedValue = (
    value: Extract<Value, { kind: "import" }>,
    env: Environment,
    seen: Set<LexicalBinding>,
  ): Value => {
    if (value.file && dirname(value.file) === join(SRC, "permissions") && CHECKS.has(value.name))
      return value;
    if (callbackArgument(value) !== undefined) return value;
    const binding = value.file ? modules.get(value.file)?.names.get(value.name) : undefined;
    return binding ? bindingValue(binding, env, seen) : value;
  };
  const bindingValue = (
    binding: LexicalBinding,
    env: Environment,
    seen: Set<LexicalBinding>,
  ): Value => {
    if (binding.reassigned || seen.has(binding)) return undefined;
    if (env.has(binding)) return env.get(binding);
    seen.add(binding);
    if (binding.imported) return importedValue({ kind: "import", ...binding.imported }, env, seen);
    return binding.init ? resolveValue(binding.init, env, seen) : undefined;
  };
  const resolveValue = (
    node: AnyNode | undefined,
    env: Environment,
    seen = new Set<LexicalBinding>(),
  ): Value => {
    if (!node) return undefined;
    if (isFunction(node)) return { kind: "function", node, env };
    if (node.type === "Identifier") {
      const binding = lookup(node);
      return binding ? bindingValue(binding, env, seen) : undefined;
    }
    if (node.type === "Literal" && typeof node.value === "string")
      return { kind: "strings", strings: [node.value] };
    if (node.type === "ConditionalExpression" || node.type === "LogicalExpression") {
      const values = [node.consequent ?? node.left, node.alternate ?? node.right].map((branch) =>
        resolveValue(branch as AnyNode, env, new Set(seen)),
      );
      return {
        kind: "strings",
        strings: values.flatMap((value) => (value?.kind === "strings" ? value.strings : [])),
      };
    }
    if (node.type === "ObjectExpression") return { kind: "object" };
    if (node.type === "ArrayExpression") {
      const elements = node.elements as (AnyNode | null)[];
      // A spread may supply elements even when the literal has none of its own.
      if (elements.some((element) => element?.type === "SpreadElement")) return undefined;
      return { kind: "array", length: elements.length, populated: elements.filter(Boolean).length };
    }
    if (node.type === "CallExpression") {
      const callee = resolveValue(node.callee as AnyNode, env, seen);
      if (
        callee?.kind === "import" &&
        callee.file === join(SRC, "operation.ts") &&
        callee.name === "markPublic"
      )
        return resolveValue((node.arguments as AnyNode[])[1], env, seen);
      if (
        callee?.kind === "import" &&
        CHECKS.has(callee.name) &&
        callee.name === "permissionsOf" &&
        callee.file &&
        dirname(callee.file) === join(SRC, "permissions")
      )
        return { kind: "permissions" };
      // A known factory can return an arbitrary object with no-op collection methods. Its
      // result is not evidence for an array callback unless we can establish its shape.
      if (callee?.kind === "function") return { kind: "factoryResult" };
    }
    return undefined;
  };
  // These are the conventional synchronous collection callbacks used by services. This is
  // syntactic coverage, not a type/control-flow proof: unknown receivers are assumed to use
  // their standard array methods. Known empty arrays, non-array values and results of local
  // factories are excluded. No arbitrary callback, getter or returned function is invoked.
  const collectionCallbacks = new Set([
    "map",
    "flatMap",
    "filter",
    "forEach",
    "some",
    "every",
    "find",
    "findIndex",
    "reduce",
    "reduceRight",
  ]);
  for (const [binding, handler] of handlers) {
    const active = new Set<AnyNode>();
    const record = (args: Value[], implied: string[] = []) => {
      binding.checks = true;
      for (const id of [
        ...implied,
        ...args.flatMap((arg) => (arg?.kind === "strings" ? arg.strings : [])),
      ])
        binding.permissions.add(id);
    };
    const invoke = (fn: Value, args: Value[]) => {
      if (fn?.kind === "import") {
        if (fn.file && dirname(fn.file) === join(SRC, "permissions") && CHECKS.has(fn.name)) {
          if (fn.name !== "permissionsOf") record(args, IMPLIED[fn.name]);
        } else {
          const callback = callbackArgument(fn);
          if (callback !== undefined) invoke(args[callback], []);
        }
        return;
      }
      if (fn?.kind !== "function" || active.has(fn.node) || fn.node.generator) return;
      active.add(fn.node);
      const env = new Map(fn.env);
      (fn.node.params as AnyNode[]).forEach((param, index) => {
        for (const id of patternNames(param)) {
          const local = lookup(id);
          if (local) env.set(local, param.type === "Identifier" ? args[index] : undefined);
        }
      });
      visit(fn.node.body as AnyNode, env);
      active.delete(fn.node);
    };
    const visit = (node: AnyNode, env: Environment) => {
      if (isFunction(node) || node.type === "ClassDeclaration" || node.type === "ClassExpression")
        return;
      if (node.type === "CallExpression") {
        const callee = node.callee as AnyNode;
        const args = (node.arguments as AnyNode[]).map((arg) => resolveValue(arg, env));
        invoke(resolveValue(callee, env), args);
        if (callee.type === "MemberExpression" && !callee.computed) {
          const object = resolveValue(callee.object as AnyNode, env);
          const member = (callee.property as AnyNode).name as string;
          if (object?.kind === "permissions" && ["can", "value"].includes(member)) record(args);
          if (collectionCallbacks.has(member)) {
            const visitsHoles = member === "find" || member === "findIndex";
            const count =
              object?.kind === "array"
                ? visitsHoles
                  ? object.length
                  : object.populated
                : undefined;
            const skipsFirst = ["reduce", "reduceRight"].includes(member) && args.length < 2;
            if (!object || (count !== undefined && count > Number(skipsFirst))) invoke(args[0], []);
          }
        }
      }
      for (const child of children(node)) visit(child, env);
    };
    const value = resolveValue(handler, new Map());
    if (value?.kind === "function" || value?.kind === "import") invoke(value, []);
    else visit(handler, new Map());
  }
  const reaches = (name: string) => bindings.get(name)?.checks ?? false;
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
function checkedPermissions({ bindings }: Analysis): Set<string> {
  const checked = new Set<string>();
  for (const b of bindings.values())
    for (const permission of b.permissions) checked.add(permission);
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

  test("an unused nested check does not guard its operation", () => {
    expect(
      unchecked(`
        export const unusedOp = implement(contract, (ctx, actor) => {
          const check = () => requirePermission(ctx, actor, "admin.permissions");
          return { ok: true };
        });
      `),
    ).toEqual(["unusedOp"]);
  });

  test("a local function shadowing an imported check does not guard its operation", () => {
    expect(
      unchecked(`
        export const shadowedOp = implement(contract, (ctx, actor) => {
          function requirePermission() {}
          requirePermission(ctx, actor, "admin.permissions");
          return { ok: true };
        });
      `),
    ).toEqual(["shadowedOp"]);
  });

  test("lexical parameters, variables, catch and loop bindings hide imported checks", () => {
    expect(
      unchecked(`
        export const parameterOp = implement(contract, (ctx, actor, requirePermission) => {
          requirePermission(ctx, actor, "admin.permissions");
        });
        export const blockOp = implement(contract, (ctx, actor) => {
          { const requirePermission = () => {}; requirePermission(); }
        });
        export const destructuredOp = implement(contract, (ctx, actor, { requirePermission }) => {
          requirePermission(ctx, actor, "admin.permissions");
        });
        export const catchOp = implement(contract, (ctx, actor) => {
          try { throw null; } catch (requirePermission) { requirePermission(); }
        });
        export const loopOp = implement(contract, (ctx, actor, input) => {
          for (const requirePermission of input.callbacks) requirePermission();
        });
        export const varOp = implement(contract, (ctx, actor) => {
          if (ctx.flag) { var requirePermission = () => {}; }
          requirePermission();
        });
        export const resolverOp = implement(contract, (ctx, actor) => {
          const permissionsOf = () => ({ can() { return true; } });
          permissionsOf(ctx, actor).can("admin.permissions");
        });
        export const holderOp = implement(contract, (ctx, actor, input) => {
          const grants = permissionsOf(ctx, actor);
          function inspect(grants) { return grants.can("admin.permissions"); }
          return inspect(input.policy);
        });
        export const reassignedOp = implement(contract, (ctx, actor) => {
          let check = requirePermission;
          check = () => {};
          check(ctx, actor, "admin.permissions");
        });
      `),
    ).toEqual([
      "parameterOp",
      "blockOp",
      "destructuredOp",
      "catchOp",
      "loopOp",
      "varOp",
      "resolverOp",
      "holderOp",
      "reassignedOp",
    ]);
  });

  test("unused callbacks, methods, generators and foreign transaction wrappers do not count", () => {
    expect(
      unchecked(`
        const discard = (callback) => ({ ok: true });
        export const discardedOp = implement(contract, (ctx, actor) =>
          discard(() => requirePermission(ctx, actor, "admin.permissions")));
        export const returnedOp = implement(contract, (ctx, actor) =>
          () => requirePermission(ctx, actor, "admin.permissions"));
        export const methodOp = implement(contract, (ctx, actor) => ({
          check() { requirePermission(ctx, actor, "admin.permissions"); }
        }));
        export const generatorOp = implement(contract, (ctx, actor) => {
          function* check() { requirePermission(ctx, actor, "admin.permissions"); }
          check();
        });
        export const foreignTxOp = implement(contract, (ctx, actor) => {
          const writeTx = (ctx, callback) => ({});
          return writeTx(ctx, () => requirePermission(ctx, actor, "admin.permissions"));
        });
        export const fakeMapOp = implement(contract, (ctx, actor) => {
          const list = { map(callback) { return []; } };
          return list.map(() => requirePermission(ctx, actor, "admin.permissions"));
        });
        export const functionMapOp = implement(contract, (ctx, actor) => {
          function list() {}
          list.map = () => [];
          return list.map(() => requirePermission(ctx, actor, "admin.permissions"));
        });
      `),
    ).toEqual([
      "discardedOp",
      "returnedOp",
      "methodOp",
      "generatorOp",
      "foreignTxOp",
      "fakeMapOp",
      "functionMapOp",
    ]);
  });

  test("invoked nested functions, checked aliases and transaction callbacks count", () => {
    const analysis = sample(`
      import { writeTx as transaction } from "../../db/tx";
      import { readWithCurrentActor } from "../../permissions";
      import { requirePermission as importedCheck } from "../../permissions";
      const invoke = (callback) => callback();
      export const nestedOp = implement(contract, (ctx, actor) => {
        const check = () => requirePermission(ctx, actor, "admin.permissions");
        check();
      });
      export const invokedOp = implement(contract, (ctx, actor) =>
        invoke(() => requirePermission(ctx, actor, "admin.groups")));
      export const aliasOp = implement(contract, (ctx, actor) => {
        const check = importedCheck;
        check(ctx, actor, "search.use");
      });
      export const txOp = implement(contract, (ctx, actor) =>
        transaction(ctx, () => requirePermission(ctx, actor, "admin.promotions")));
      export const readOp = implement(contract, (ctx, actor) =>
        readWithCurrentActor(ctx, actor, (current) =>
          requirePermission(ctx, current, "admin.members")));
    `);
    expect(uncheckedFunctions(analysis)).toEqual([]);
    expect([...checkedPermissions(analysis)].sort()).toEqual([
      "admin.groups",
      "admin.members",
      "admin.permissions",
      "admin.promotions",
      "forum.reply",
      "search.use",
    ]);
  });

  test("empty arrays and known factory results do not invoke checks", () => {
    expect(
      unchecked(`
        export const emptyMapOp = implement(contract, (ctx, actor) =>
          [].map(() => requirePermission(ctx, actor, "admin.permissions")));
        export const emptyFilterOp = implement(contract, (ctx, actor) => {
          const rows = [];
          return rows.filter(() => requirePermission(ctx, actor, "admin.permissions"));
        });
        export const factoryMapOp = implement(contract, (ctx, actor) => {
          function ignored() { return { map() { return []; } }; }
          return ignored().map(() => requirePermission(ctx, actor, "admin.permissions"));
        });
        export const sparseMapOp = implement(contract, (ctx, actor) =>
          [, ,].map(() => requirePermission(ctx, actor, "admin.permissions")));
        export const singletonReduceOp = implement(contract, (ctx, actor) =>
          [1].reduce(() => requirePermission(ctx, actor, "admin.permissions")));
      `),
    ).toEqual(["emptyMapOp", "emptyFilterOp", "factoryMapOp", "sparseMapOp", "singletonReduceOp"]);
  });

  test("nonempty literal array methods invoke their callbacks", () => {
    expect(
      unchecked(`
        export const literalMapOp = implement(contract, (ctx, actor) =>
          [1].map(() => requirePermission(ctx, actor, "admin.permissions")));
        export const reduceOp = implement(contract, (ctx, actor) =>
          [1].reduce(() => requirePermission(ctx, actor, "admin.permissions"), 0));
        export const sparseFindOp = implement(contract, (ctx, actor) =>
          [, ,].find(() => requirePermission(ctx, actor, "admin.permissions")));
      `),
    ).toEqual([]);
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

  describe("callbacks passed to collection methods", () => {
    const CHECK = `requirePermission(ctx, actor, "admin.permissions")`;
    // The receiver is unknown to the analyzer: a parameter of the operation.
    for (const method of [
      "map",
      "flatMap",
      "filter",
      "forEach",
      "some",
      "every",
      "find",
      "findIndex",
      "reduce",
      "reduceRight",
    ])
      test(`${method} invokes its callback`, () => {
        expect(
          unchecked(`
            export const op = implement(contract, (ctx, actor, input) =>
              input.rows.${method}(() => ${CHECK}));
          `),
        ).toEqual([]);
      });

    for (const method of ["push", "then", "set", "addListener", "sort"])
      test(`${method} is not a collection callback method`, () => {
        expect(
          unchecked(`
            export const op = implement(contract, (ctx, actor, input) =>
              input.rows.${method}(() => ${CHECK}));
          `),
        ).toEqual(["op"]);
      });

    test("a callback stored in a variable counts when it is passed to a collection method", () => {
      expect(
        unchecked(`
          export const arrowOp = implement(contract, (ctx, actor, input) => {
            const check = () => ${CHECK};
            return input.rows.forEach(check);
          });
          export const declarationOp = implement(contract, (ctx, actor, input) => {
            function check() { ${CHECK}; }
            return input.rows.some(check);
          });
          export const literalOp = implement(contract, (ctx, actor) => {
            const check = () => ${CHECK};
            return [1, 2].every(check);
          });
          export const aliasOp = implement(contract, (ctx, actor, input) => {
            const check = () => ${CHECK};
            const alias = check;
            return input.rows.find(alias);
          });
          export const wrappedOp = implement(contract, (ctx, actor, input) => {
            const check = () => ${CHECK};
            return input.rows.map((row) => check(row));
          });
          export const helperOp = implement(contract, (ctx, actor, input) => {
            const each = (rows, callback) => rows.forEach(callback);
            return each(input.rows, () => ${CHECK});
          });
        `),
      ).toEqual([]);
    });

    test("a callback stored in a variable does not count when it is never invoked", () => {
      expect(
        unchecked(`
          export const storedOp = implement(contract, (ctx, actor, input) => {
            const check = () => ${CHECK};
            return input.rows.map((row) => row.id);
          });
          export const otherOp = implement(contract, (ctx, actor, input) => {
            const check = () => ${CHECK};
            const other = () => 1;
            return input.rows.map(other);
          });
          export const pushedOp = implement(contract, (ctx, actor, input) => {
            const check = () => ${CHECK};
            return input.rows.push(check);
          });
          export const reassignedOp = implement(contract, (ctx, actor, input) => {
            let check = () => ${CHECK};
            check = () => 1;
            return input.rows.map(check);
          });
          export const emptyOp = implement(contract, (ctx, actor) => {
            const check = () => ${CHECK};
            return [].forEach(check);
          });
        `),
      ).toEqual(["storedOp", "otherOp", "pushedOp", "reassignedOp", "emptyOp"]);
    });

    test("optional chaining does not hide an invoked callback or an imported check", () => {
      const analysis = sample(`
        export const memberOp = implement(contract, (ctx, actor, input) =>
          input.rows?.map(() => ${CHECK}));
        export const callOp = implement(contract, (ctx, actor, input) =>
          input.rows.map?.(() => ${CHECK}));
        export const bothOp = implement(contract, (ctx, actor, input) => {
          const check = () => ${CHECK};
          return input.page?.rows?.forEach?.(check);
        });
        export const directOp = implement(contract, (ctx, actor) =>
          requirePermission?.(ctx, actor, "admin.groups"));
        export const grantsOp = implement(contract, (ctx, actor) =>
          permissionsOf(ctx, actor)?.can("admin.members"));
        export const shadowedOp = implement(contract, (ctx, actor, requirePermission) =>
          requirePermission?.(ctx, actor, "admin.promotions"));
        export const emptyOp = implement(contract, (ctx, actor) =>
          [].map?.(() => ${CHECK}));
      `);
      expect(uncheckedFunctions(analysis).map((entry) => entry.split(": ")[1])).toEqual([
        "shadowedOp",
        "emptyOp",
      ]);
      expect([...checkedPermissions(analysis)].sort()).toEqual([
        "admin.groups",
        "admin.members",
        "admin.permissions",
        "forum.reply",
      ]);
    });

    // Decision: the analysis is not path-sensitive (a check in one branch of an `if` counts), so
    // a collection that is merely possibly empty counts as invoking its callback. Only a
    // receiver the analyzer can see is empty (an empty literal, or a local initialised with
    // one) does not. Anything it cannot see into (a conditional or logical expression included)
    // is not evidence that the callback runs for a plain array method, and is not counted.
    test("a possibly empty collection counts, a visibly empty one and an opaque one do not", () => {
      expect(
        unchecked(`
          import { listRows } from "./rows";
          export const parameterOp = implement(contract, (ctx, actor, input) =>
            input.ids.map(() => ${CHECK}));
          export const destructuredOp = implement(contract, (ctx, actor, { ids }) =>
            ids.map(() => ${CHECK}));
          export const importedOp = implement(contract, (ctx, actor) =>
            listRows(ctx).forEach(() => ${CHECK}));
          export const filledOp = implement(contract, (ctx, actor) => {
            const rows = [1];
            return rows.map(() => ${CHECK});
          });
          export const emptyOp = implement(contract, (ctx, actor) => {
            const rows = [];
            return rows.map(() => ${CHECK});
          });
          export const pushedOp = implement(contract, (ctx, actor, input) => {
            const rows = [];
            rows.push(...input.rows);
            return rows.map(() => ${CHECK});
          });
          export const fallbackOp = implement(contract, (ctx, actor, input) =>
            (input.ids ?? []).map(() => ${CHECK}));
        `),
      ).toEqual(["emptyOp", "pushedOp", "fallbackOp"]);
    });

    test("a callback nested in an invoked callback is followed, one in an unused one is not", () => {
      expect(
        unchecked(`
          export const nestedOp = implement(contract, (ctx, actor, input) =>
            input.groups.map((group) => group.rows.forEach(() => ${CHECK})));
          export const unusedOp = implement(contract, (ctx, actor, input) =>
            input.groups.map((group) => () => group.rows.forEach(() => ${CHECK})));
        `),
      ).toEqual(["unusedOp"]);
    });
  });
});
