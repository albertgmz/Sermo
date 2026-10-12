import { expect, test } from "bun:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { GUEST, operations } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import type * as z from "zod";
import { createMcpHandler, toolInputSchema } from "./index";

function guestHandler(options: Partial<Parameters<typeof createMcpHandler>[0]> = {}) {
  const ctx = createTestContext();
  const handler = createMcpHandler({
    ctx,
    resolveActor: async () => ({ actor: GUEST, setCookies: [] }),
    ...options,
  });
  return { ctx, handler };
}

function rpc(method: string, params?: object, id?: number) {
  return {
    jsonrpc: "2.0",
    method,
    ...(id === undefined ? {} : { id }),
    ...(params ? { params } : {}),
  };
}

function post(
  handler: (request: Request) => Promise<Response>,
  body: unknown,
  signal?: AbortSignal,
) {
  return handler(
    new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    }),
  );
}

const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, Bun.sleep(ms).then(() => "timeout" as const)]);

test("a batch with a cancellation notification completes instead of hanging", async () => {
  const { handler } = guestHandler();
  const outcome = await within(
    post(handler, [
      rpc("tools/call", { name: "nodes_list", arguments: {} }, 11),
      rpc("ping", undefined, 12),
      rpc("notifications/cancelled", { requestId: 11 }),
    ]),
    1500,
  );
  expect(outcome).not.toBe("timeout");
  if (outcome === "timeout") return;
  expect(outcome.status).toBe(400);
  expect((await outcome.json()).error.code).toBe(-32600);
});

test("a single cancellation notification is still accepted", async () => {
  const { handler } = guestHandler();
  const response = await post(handler, rpc("notifications/cancelled", { requestId: 11 }));
  expect(response.status).toBe(202);
});

test("an aborted request settles even when a tool call never finishes", async () => {
  const { handler } = guestHandler({ allowCall: () => new Promise<boolean>(() => {}) });
  const controller = new AbortController();
  const pending = post(
    handler,
    rpc("tools/call", { name: "nodes_list", arguments: {} }, 1),
    controller.signal,
  );
  setTimeout(() => controller.abort(), 20);
  expect(await within(pending, 1500)).not.toBe("timeout");
});

test("malformed tool arguments return the validation tool error", async () => {
  const { handler } = guestHandler();
  for (const args of [null, [], 1, "x", true]) {
    const response = await post(
      handler,
      rpc("tools/call", { name: "nodes_list", arguments: args }, 1),
    );
    const body = await response.json();
    expect(body.error).toBeUndefined();
    const result = body.result as CallToolResult;
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    const error = JSON.parse(text).error;
    expect(error.code).toBe("validation");
    expect(text).not.toContain("Invalid tools/call");
  }
});

test("malformed arguments in a batch only fail their own entry", async () => {
  const { handler } = guestHandler();
  const response = await post(handler, [
    rpc("tools/call", { name: "nodes_list", arguments: null }, 1),
    rpc("tools/call", { name: "nodes_list", arguments: {} }, 2),
  ]);
  const results = (await response.json()) as { id: number; result: CallToolResult }[];
  const byId = new Map(results.map((entry) => [entry.id, entry.result]));
  expect(byId.get(1)?.isError).toBe(true);
  expect(byId.get(2)?.isError).not.toBe(true);
});

test("write tools do not claim to be non-destructive; deletes are destructive", async () => {
  const { handler } = guestHandler();
  const response = await post(handler, rpc("tools/list", undefined, 1));
  const { tools } = (await response.json()).result as {
    tools: { name: string; annotations: Record<string, boolean> }[];
  };
  for (const op of operations) {
    const tool = tools.find((item) => item.name === op.name.replaceAll(".", "_"))!;
    expect(tool.annotations.readOnlyHint).toBe(op.kind === "read");
    expect(tool.annotations.destructiveHint).not.toBe(false);
    if (op.kind === "write" && /\.(delete|remove)$/.test(op.name))
      expect(tool.annotations.destructiveHint).toBe(true);
  }
});

// A minimal check of a published JSON Schema against a value, covering the keywords the
// contracts produce for scalar fields.
function jsonAccepts(schema: Record<string, unknown>, value: unknown): boolean {
  const variants = (schema.anyOf ?? schema.oneOf) as Record<string, unknown>[] | undefined;
  if (variants) return variants.some((variant) => jsonAccepts(variant, value));
  const types = ([] as unknown[]).concat(schema.type ?? []);
  if (types.length) {
    const ok = types.some((type) =>
      type === "integer"
        ? Number.isInteger(value)
        : type === "number"
          ? typeof value === "number"
          : type === "null"
            ? value === null
            : typeof value === type,
    );
    if (!ok) return false;
  }
  if ("const" in schema && schema.const !== value) return false;
  if (schema.not && jsonAccepts(schema.not as Record<string, unknown>, value)) return false;
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum)
      return false;
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum)
      return false;
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value))
      return false;
  }
  return true;
}

type Def = { type: string; [key: string]: unknown };
const defOf = (schema: z.ZodType) => (schema as unknown as { _zod: { def: Def } })._zod.def;

function candidates(zod: z.ZodType, json: Record<string, unknown>): unknown[] {
  const def = defOf(zod);
  if (def.type === "string") {
    const max = typeof json.maxLength === "number" ? json.maxLength : 50;
    return [
      "x",
      " x ",
      "x".repeat(max),
      ` ${"x".repeat(max)} `,
      `${" ".repeat(max + 1)}x`,
      "   ",
      "Ab-1",
      " ab-1 ",
    ];
  }
  if (def.type === "number") {
    const numbers = [0, 1, -1, 5, 1000];
    for (const key of ["minimum", "maximum"] as const)
      if (typeof json[key] === "number") numbers.push(json[key] as number);
    return numbers;
  }
  return [];
}

function walk(
  zod: z.ZodType,
  json: Record<string, unknown>,
  root: Record<string, unknown>,
  path: string,
  failures: string[],
) {
  let schema = json;
  if (typeof schema.$ref === "string") {
    const target = (root.$defs as Record<string, Record<string, unknown>>)[
      schema.$ref.replace("#/$defs/", "")
    ];
    schema = { ...target, ...schema };
  }
  const def = defOf(zod);
  switch (def.type) {
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "nonoptional":
      return walk(def.innerType as z.ZodType, schema, root, path, failures);
    case "pipe":
      return walk(def.in as z.ZodType, schema, root, path, failures);
    case "array":
      return walk(
        def.element as z.ZodType,
        (schema.items ?? {}) as Record<string, unknown>,
        root,
        `${path}[]`,
        failures,
      );
    case "object": {
      const shape = def.shape as Record<string, z.ZodType>;
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      for (const [name, child] of Object.entries(shape))
        if (props[name]) walk(child, props[name], root, `${path}.${name}`, failures);
      return;
    }
    case "union": {
      const options = def.options as z.ZodType[];
      const variants = (schema.anyOf ?? schema.oneOf) as Record<string, unknown>[] | undefined;
      if (variants?.length === options.length)
        options.forEach((option, index) => {
          walk(
            option,
            variants[index] as Record<string, unknown>,
            root,
            `${path}|${index}`,
            failures,
          );
        });
      return;
    }
    default:
      for (const value of candidates(zod, schema))
        if (zod.safeParse(value).success && !jsonAccepts(schema, value))
          failures.push(
            `${path}: server accepts ${JSON.stringify(value).slice(0, 24)} (${String(value).length} chars), schema rejects it`,
          );
  }
}

test("published input schemas never reject input the server accepts", () => {
  const failures: string[] = [];
  for (const op of operations) {
    const schema = toolInputSchema(op) as Record<string, unknown>;
    walk(op.input, schema, schema, op.name, failures);
  }
  expect(failures).toEqual([]);
});

test("published schemas express the nonzero constraint on credit amounts", () => {
  const adjust = toolInputSchema(
    operations.find((op) => op.name === "credits.adjust")!,
  ) as unknown as {
    properties: { amount: Record<string, unknown> };
  };
  expect(jsonAccepts(adjust.properties.amount, 0)).toBe(false);
  expect(jsonAccepts(adjust.properties.amount, 5)).toBe(true);
  const padded = toolInputSchema(
    operations.find((op) => op.name === "shopCategories.create")!,
  ) as unknown as {
    properties: { name: Record<string, unknown> };
  };
  expect(jsonAccepts(padded.properties.name, `${" ".repeat(100)}x`)).toBe(true);
});
