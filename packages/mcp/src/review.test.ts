import { afterEach, expect, spyOn, test } from "bun:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  MAX_BATCH_SIZE,
} from "@modelcontextprotocol/sdk/server/requestBody.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { type Ctx, closeContext, GUEST, operations } from "@sermo/core";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import * as z from "zod";
import { createMcpHandler, toolInputSchema } from "./index";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

function guestHandler(options: Partial<Parameters<typeof createMcpHandler>[0]> = {}) {
  const ctx = createTestContext();
  contexts.push(ctx);
  const handler = createMcpHandler({
    ctx,
    resolveActor: async () => ({ actor: GUEST, setCookies: [] }),
    ...options,
  });
  return { ctx, handler };
}

function rpc(method: string, params?: object, id?: number | string) {
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
  const outcome = await within(pending, 1500);
  expect(outcome).not.toBe("timeout");
  if (outcome !== "timeout") expect(outcome.status).toBe(499);
});

test("a delayed call permission cannot start a write after the request aborts", async () => {
  let allow!: (allowed: boolean) => void;
  let entered!: () => void;
  const checking = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const allowed = new Promise<boolean>((resolve) => {
    allow = resolve;
  });
  const { ctx, handler } = guestHandler({
    resolveActor: async () => ({ actor: admin, setCookies: [] }),
    allowCall: () => {
      entered();
      return allowed;
    },
  });
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const controller = new AbortController();
  const pending = post(
    handler,
    rpc(
      "tools/call",
      {
        name: "nodes_create",
        arguments: { parentId: null, type: "forum", title: "Aborted write" },
      },
      1,
    ),
    controller.signal,
  );
  expect(await within(checking, 1000)).not.toBe("timeout");
  controller.abort();
  const response = await within(pending, 1000);
  expect(response).not.toBe("timeout");
  if (response !== "timeout") expect(response.status).toBe(499);
  allow(true);
  // Drain the resumed handler and SDK response tasks before checking the write's effect.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ctx.sqlite.query("SELECT id FROM nodes WHERE title = 'Aborted write'").get()).toBeNull();
});

const mcpHeaders = {
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
};

test.each([
  [{}, 406],
  [{ accept: mcpHeaders.accept }, 415],
  [{ ...mcpHeaders, "content-type": "text/plain" }, 415],
  [{ "content-type": "application/json" }, 406],
  [{ ...mcpHeaders, accept: "application/json" }, 406],
  [{ ...mcpHeaders, "content-type": "text/plain; a=application/json" }, 415],
] as const)(
  "transport headers are validated before malformed or unfinished bodies: %j",
  async (headers, status) => {
    const { handler } = guestHandler();
    const sdk = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const init = { method: "POST", headers, body: "" };
    const expected = await sdk.handleRequest(new Request("http://localhost/mcp", init));
    await sdk.close();
    const response = await handler(new Request("http://localhost/mcp", init));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(await expected.json());

    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>();
    const pending = handler(
      new Request("http://localhost/mcp", { ...init, body, signal: controller.signal }),
    );
    try {
      const outcome = await within(pending, 200);
      expect(outcome).not.toBe("timeout");
      if (outcome !== "timeout") expect(outcome.status).toBe(status);
      expect(body.locked).toBe(false);
    } finally {
      controller.abort();
    }
  },
);

test.each([false, true])(
  "aborting an unfinished body settles as 499 and releases resources (pre-aborted: %s)",
  async (preAborted) => {
    let cancelled = false;
    let readStarted!: () => void;
    const reading = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          readStarted();
        },
        cancel() {
          cancelled = true;
          return new Promise<void>(() => {});
        },
      },
      { highWaterMark: 0 },
    );
    let charged = 0;
    const { handler } = guestHandler({
      allowCall: () => {
        charged++;
        return true;
      },
    });
    const closeServer = spyOn(Server.prototype, "close");
    const closeTransport = spyOn(WebStandardStreamableHTTPServerTransport.prototype, "close");
    const controller = new AbortController();
    if (preAborted) controller.abort();
    const pending = handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: mcpHeaders,
        body,
        signal: controller.signal,
      }),
    );
    try {
      if (!preAborted) {
        expect(await within(reading, 1000)).not.toBe("timeout");
        controller.abort();
      }
      const outcome = await within(pending, 200);
      expect(outcome).not.toBe("timeout");
      if (outcome !== "timeout") {
        expect(outcome.status).toBe(499);
        expect((await outcome.json()).error.message).toContain("Client closed");
      }
      expect(charged).toBe(0);
      expect(body.locked).toBe(false);
      if (!preAborted) expect(cancelled).toBe(true);
      expect(closeServer).toHaveBeenCalledOnce();
      expect(closeTransport).toHaveBeenCalledOnce();
    } finally {
      closeServer.mockRestore();
      closeTransport.mockRestore();
    }
  },
);

test("unfinished bodies have a deadline even without a client abort", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
      return new Promise<void>(() => {});
    },
  });
  const { handler } = guestHandler({ requestBodyTimeoutMs: 20 });
  const outcome = await within(
    handler(new Request("http://localhost/mcp", { method: "POST", headers: mcpHeaders, body })),
    200,
  );
  expect(outcome).not.toBe("timeout");
  if (outcome !== "timeout") expect(outcome.status).toBe(408);
  expect(cancelled).toBe(true);
  expect(body.locked).toBe(false);
});

test("unsupported methods reject an unfinished body without reading or resolving an actor", async () => {
  let resolved = 0;
  const { handler } = guestHandler({
    resolveActor: async () => {
      resolved++;
      return { actor: GUEST, setCookies: [] };
    },
  });
  for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const response = await within(
      handler(
        new Request("http://localhost/mcp", {
          method,
          headers: mcpHeaders,
          ...(["GET", "HEAD"].includes(method) ? {} : { body }),
        }),
      ),
      1000,
    );
    expect(response).not.toBe("timeout");
    if (response !== "timeout") expect(response.status).toBe(405);
    expect(pulled).toBe(false);
    expect(body.locked).toBe(false);
  }
  expect(resolved).toBe(0);
});

test("body read failures return parse errors and still clean up", async () => {
  const cookies = ["session=fresh; Path=/; HttpOnly"];
  const { handler } = guestHandler({
    resolveActor: async () => ({ actor: GUEST, setCookies: cookies }),
  });
  for (const locked of [false, true]) {
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.error(new Error("read failed"));
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request("http://localhost/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body,
    });
    const reader = locked ? body.getReader() : undefined;
    const closeServer = spyOn(Server.prototype, "close");
    const closeTransport = spyOn(WebStandardStreamableHTTPServerTransport.prototype, "close");
    try {
      const response = await handler(request);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe(-32700);
      expect(response.headers.getSetCookie()).toEqual(cookies);
      expect(closeServer).toHaveBeenCalledOnce();
      expect(closeTransport).toHaveBeenCalledOnce();
    } finally {
      reader?.releaseLock();
      closeServer.mockRestore();
      closeTransport.mockRestore();
    }
  }
});

test("streamed bodies enforce the byte limit and decode split UTF-8 sequences", async () => {
  const { handler } = guestHandler();
  let cancelled = false;
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(DEFAULT_MAX_REQUEST_BODY_SIZE).fill(32));
      controller.enqueue(new TextEncoder().encode("é"));
    },
    cancel() {
      cancelled = true;
      return new Promise<void>(() => {});
    },
  });
  const response = await within(
    handler(
      new Request("http://localhost/mcp", { method: "POST", headers: mcpHeaders, body: oversized }),
    ),
    1000,
  );
  expect(response).not.toBe("timeout");
  if (response !== "timeout") expect(response.status).toBe(413);
  expect(cancelled).toBe(true);
  expect(oversized.locked).toBe(false);

  const encoded = new TextEncoder().encode(JSON.stringify(rpc("ping", undefined, "é")));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const ok = await handler(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { ...mcpHeaders, "content-type": "Application/JSON; charset=utf-8" },
      body,
    }),
  );
  expect(ok.status).toBe(200);
  expect((await ok.json()).id).toBe("é");
});

test("standalone responses retain resolved cookies exactly once on every early return", async () => {
  const setCookies = ["session=fresh; Path=/; HttpOnly", "cache=fresh; Path=/; HttpOnly"];
  const { handler } = guestHandler({ resolveActor: async () => ({ actor: GUEST, setCookies }) });
  const cases: { body: string; status: number; headers?: Record<string, string> }[] = [
    { body: "{", status: 400 },
    {
      body: "",
      headers: { "content-length": String(DEFAULT_MAX_REQUEST_BODY_SIZE + 1) },
      status: 413,
    },
    { body: "x".repeat(DEFAULT_MAX_REQUEST_BODY_SIZE + 1), status: 413 },
    {
      body: JSON.stringify(
        Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, id) => rpc("ping", undefined, id)),
      ),
      status: 400,
    },
    {
      body: JSON.stringify([
        rpc("ping", undefined, 1),
        rpc("notifications/cancelled", { requestId: 1 }),
      ]),
      status: 400,
    },
    { body: JSON.stringify([rpc("ping", undefined, 7), rpc("ping", undefined, 7)]), status: 400 },
    { body: "{}", status: 400 },
    { body: "", headers: { accept: "application/json" }, status: 406 },
    { body: "", headers: { "content-type": "text/plain" }, status: 415 },
    {
      body: JSON.stringify(rpc("ping", undefined, 1)),
      headers: { "mcp-protocol-version": "invalid" },
      status: 400,
    },
    { body: JSON.stringify(rpc("ping", undefined, 1)), status: 200 },
    { body: JSON.stringify(rpc("notifications/initialized")), status: 202 },
  ];
  const failures: unknown[] = [];
  for (const entry of cases) {
    const closeServer = spyOn(Server.prototype, "close");
    const closeTransport = spyOn(WebStandardStreamableHTTPServerTransport.prototype, "close");
    let response: Response;
    try {
      response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { ...mcpHeaders, ...entry.headers },
          body: entry.body,
        }),
      );
      expect(closeServer).toHaveBeenCalledOnce();
      expect(closeTransport).toHaveBeenCalledOnce();
    } finally {
      closeServer.mockRestore();
      closeTransport.mockRestore();
    }
    if (
      response.status !== entry.status ||
      JSON.stringify(response.headers.getSetCookie()) !== JSON.stringify(setCookies)
    )
      failures.push({
        expected: entry.status,
        status: response.status,
        cookies: response.headers.getSetCookie(),
      });
  }
  expect(failures).toEqual([]);
});

test.each([false, true])(
  "standalone body timeouts and aborts retain cookies (abort: %s)",
  async (abort) => {
    const cookies = ["session=fresh; Path=/; HttpOnly", "cache=fresh; Path=/; HttpOnly"];
    const { handler } = guestHandler({
      requestBodyTimeoutMs: 20,
      resolveActor: async () => ({ actor: GUEST, setCookies: cookies }),
    });
    const controller = new AbortController();
    if (abort) controller.abort();
    const response = await within(
      handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: mcpHeaders,
          body: new ReadableStream<Uint8Array>(),
          signal: controller.signal,
        }),
      ),
      1000,
    );
    expect(response).not.toBe("timeout");
    if (response !== "timeout") {
      expect(response.status).toBe(abort ? 499 : 408);
      expect(response.headers.getSetCookie()).toEqual(cookies);
    }
  },
);

test.each([7, "7", "__proto__"])(
  "duplicate batch request ids are rejected without charging or dispatch: %s",
  async (id) => {
    let charged = 0;
    const { handler } = guestHandler({
      allowCall: () => {
        charged++;
        return true;
      },
    });
    for (const first of [
      rpc("tools/call", { name: "nodes_list", arguments: null }, id),
      rpc("tools/call", { name: "nodes_list", arguments: {} }, id),
      rpc("ping", undefined, id),
    ]) {
      const response = await post(handler, [
        first,
        rpc("tools/call", { name: "nodes_list", arguments: {} }, id),
      ]);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: expect.stringContaining("Duplicate request id") },
      });
      expect(charged).toBe(0);
    }
  },
);

test("duplicate batch ids reject valid writes before any mutation", async () => {
  let charged = 0;
  const { ctx, handler } = guestHandler({
    resolveActor: async () => ({ actor: admin, setCookies: [] }),
    allowCall: () => {
      charged++;
      return true;
    },
  });
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const response = await post(
    handler,
    ["first", "second"].map((title) =>
      rpc(
        "tools/call",
        {
          name: "nodes_create",
          arguments: { parentId: null, type: "forum", title },
        },
        7,
      ),
    ),
  );
  expect(response.status).toBe(400);
  expect(charged).toBe(0);
  expect(ctx.sqlite.query("SELECT id FROM nodes").all()).toEqual([]);
});

test("numeric and string ids are distinct and notifications need no ids", async () => {
  const { handler } = guestHandler();
  const response = await post(handler, [
    rpc("ping", undefined, 7),
    rpc("ping", undefined, "7"),
    rpc("notifications/initialized"),
    rpc("notifications/initialized"),
  ]);
  expect(response.status).toBe(200);
  expect((await response.json()).map((entry: { id: unknown }) => entry.id)).toEqual([7, "7"]);
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

// The SDK's own AJV provider loads AJV and ajv-formats from its dependency tree.
const validator = new AjvJsonSchemaValidator();
function jsonAccepts(schema: Record<string, unknown>, value: unknown): boolean {
  return validator.getValidator(schema)(value).valid;
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
      ...[
        "https://example.test/push",
        "mailto:a@example.test",
        "https://example.test/a b",
        "https://exa\tmple.test/push",
        "a@example.test",
      ].flatMap((value) => [value, ` \t${value}\n `, `${" ".repeat(max + 1)}${value}`]),
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
    const target = (root.definitions as Record<string, Record<string, unknown>>)[
      schema.$ref.replace("#/definitions/", "")
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
      for (const [name, child] of Object.entries(shape)) {
        const optional = (child as unknown as { _zod: { optin?: string } })._zod.optin;
        if (optional !== undefined && (schema.required as string[] | undefined)?.includes(name))
          failures.push(`${path}.${name}: the server fills it in, but the schema requires it`);
      }
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
    default: {
      const candidateSchema: Record<string, unknown> = { ...schema, definitions: root.definitions };
      const validate = validator.getValidator(candidateSchema);
      for (const value of candidates(zod, schema))
        if (zod.safeParse(value).success && !validate(value).valid)
          failures.push(
            `${path}: server accepts ${JSON.stringify(value).slice(0, 24)} (${String(value).length} chars), schema rejects it`,
          );
    }
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

test("published schemas admit URL normalization, overwrites, pipes and preprocessors", () => {
  const cases: [z.ZodType, unknown][] = [
    [z.url().max(30), "  https://example.test/path  "],
    [z.url().max(30), `${" ".repeat(40)}https://example.test`],
    [z.url().max(30), "https://exa\tmple.test"],
    [
      z
        .string()
        .toUpperCase()
        .regex(/^[A-Z]+$/),
      "abc",
    ],
    [
      z
        .string()
        .toUpperCase()
        .regex(/^[A-Z]+$/)
        .regex(/^A/),
      "abc",
    ],
    [
      z
        .string()
        .overwrite((value) => value.repeat(2))
        .min(4),
      "ab",
    ],
    [
      z
        .string()
        .overwrite((value) => value.slice(0, 2))
        .max(2),
      "abcdef",
    ],
    [z.string().normalize().regex(/^é$/), "e\u0301"],
    [z.string().trim().email(), " a@example.test "],
    [z.string().url().max(30), `${" ".repeat(40)}https://example.test`],
    [z.url().regex(/^https:\/\/example.test$/), " https://exa\tmple.test "],
    [
      z
        .string()
        .transform((value) => value.trim())
        .pipe(z.email()),
      " a@example.test ",
    ],
    [z.string().trim().pipe(z.email()), " a@example.test "],
    [z.preprocess((value) => String(value).trim(), z.email()), " a@example.test "],
    [z.preprocess((value) => `https://example.test/${value}`, z.url()), 42],
    [
      z
        .preprocess((value) => String(value).trim(), z.email().meta({ id: "NormalizedEmail" }))
        .optional(),
      " a@example.test ",
    ],
  ];
  for (const [field, value] of cases) {
    const input = z.object({ value: field });
    expect(input.safeParse({ value }).success).toBe(true);
    const schema = toolInputSchema({ ...operations[0]!, input } as (typeof operations)[number]);
    expect({ value, valid: jsonAccepts(schema, { value }), schema }).toEqual({
      value,
      valid: true,
      schema,
    });
  }
  // Ensure the validator really enforces formats and patterns.
  expect(jsonAccepts({ type: "string", format: "uri" }, " https://example.test ")).toBe(false);
  expect(jsonAccepts({ type: "string", pattern: "^[A-Z]+$" }, "abc")).toBe(false);
});

test("published schemas admit coercions, non-string overwrites and missing preprocessed inputs", () => {
  const cases: [z.ZodType, unknown][] = [
    [z.coerce.number().min(10), "12"],
    [z.coerce.string().min(3), 123],
    [z.coerce.boolean(), 0],
    [
      z
        .number()
        .overwrite((value) => value * 10)
        .min(10),
      2,
    ],
    [z.number().overwrite(Math.round).int(), 1.2],
    [
      z
        .array(z.number())
        .overwrite(() => [])
        .max(0),
      [1],
    ],
    [z.object({ filled: z.preprocess((value) => value ?? "fallback", z.string()) }), {}],
    [z.tuple([z.preprocess((value) => value ?? "fallback", z.string())]), []],
    [z.tuple([z.number(), z.preprocess((value) => value ?? "fallback", z.string())]), [1]],
  ];
  const failures: unknown[] = [];
  for (const [field, value] of cases) {
    const input = z.object({ value: field });
    expect(input.safeParse({ value }).success).toBe(true);
    const schema = toolInputSchema({ ...operations[0]!, input } as (typeof operations)[number]);
    if (!jsonAccepts(schema, { value })) failures.push({ value, schema });
  }
  expect(failures).toEqual([]);
});

type Json = {
  $ref?: string;
  const?: unknown;
  enum?: unknown[];
  anyOf?: Json[];
  oneOf?: Json[];
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Json>;
  items?: Json;
  minItems?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  format?: string;
  pattern?: string;
  description?: string;
  definitions?: Record<string, Json>;
};

const patternSamples: Record<string, string> = {
  "^B[A-Za-z0-9_-]{86}=?$": `B${"A".repeat(86)}`,
  "^[A-Za-z0-9_-]{21}[AQgw](==)?$": `${"A".repeat(21)}A`,
  "^#[0-9a-fA-F]{6}$": "#aabbcc",
  "^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$": "terms",
};

/** The smallest input the published schema describes: required properties only. */
function minimalSample(schema: Json, root: Json): unknown {
  if (typeof schema.$ref === "string")
    return minimalSample(root.definitions?.[schema.$ref.replace("#/definitions/", "")] ?? {}, root);
  if ("const" in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) return minimalSample(variants[0] ?? {}, root);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case "object":
      return Object.fromEntries(
        ((schema.required ?? []) as string[]).map((name) => [
          name,
          minimalSample(schema.properties?.[name] ?? {}, root),
        ]),
      );
    case "array":
      return Array.from({ length: schema.minItems ?? 0 }, () =>
        minimalSample(schema.items ?? {}, root),
      );
    case "string":
      if (schema.format === "date-time") return "2030-01-01T00:00:00.000Z";
      if (schema.pattern !== undefined)
        return patternSamples[schema.pattern] ?? `no sample for ${schema.pattern}`;
      // A navigation target is checked by a refinement the published schema cannot express.
      if (String(schema.description).includes("At most 500 characters")) return "/forums";
      // Normalized URL fields move their format into the description.
      if (String(schema.description).includes("Format: uri")) return "https://example.test/push";
      return "x".repeat(Math.max(schema.minLength ?? 0, 1));
    case "integer":
    case "number": {
      let value = Math.max(schema.minimum ?? 1, (schema.exclusiveMinimum ?? 0) + 1, 1);
      if (schema.maximum !== undefined) value = Math.min(value, schema.maximum);
      return value;
    }
    case "boolean":
      return true;
    case "null":
      return null;
    default:
      return null;
  }
}

test("for every real contract, a minimal input valid per the published schema is accepted", () => {
  const failures: string[] = [];
  for (const op of operations) {
    const schema = toolInputSchema(op) as Json;
    const sample = minimalSample(schema, schema);
    if (!jsonAccepts(schema, sample)) failures.push(`${op.name}: sample not valid per schema`);
    else if (!op.input.safeParse(sample).success)
      failures.push(`${op.name}: parser rejects ${JSON.stringify(sample)}`);
  }
  expect(failures).toEqual([]);
});
