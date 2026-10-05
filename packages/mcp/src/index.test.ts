import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execute, GUEST, operations } from "@sermo/core";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import * as z from "zod";
import { getAuth, resolveActor } from "../../core/src/modules/auth";
import { nodesCreateOp } from "../../core/src/modules/forums";
import { createMcpHandler } from "./index";

function setup() {
  const ctx = createTestContext();
  const handler = createMcpHandler({
    ctx,
    resolveActor: (request) => resolveActor(ctx, request.headers),
  });
  const client = (authorization?: string) => {
    const mcp = new Client({ name: "sermo-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3000/mcp"), {
      requestInit: authorization ? { headers: { Authorization: authorization } } : undefined,
      fetch: (url, init) => handler(new Request(url, init)),
    });
    return { mcp, transport };
  };
  return { ctx, handler, client };
}

function requestBody(method: string, params?: object, id = 1) {
  return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

async function post(
  handler: (request: Request) => Promise<Response>,
  body: unknown,
  headers?: HeadersInit,
) {
  return handler(
    new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
}

function errorCode(result: CallToolResult) {
  const item = result.content[0];
  expect(item?.type).toBe("text");
  if (item?.type !== "text") throw new Error("Missing error text");
  return JSON.parse(item.text).error as { code: string; message: string; issues?: unknown[] };
}

test("API key client lists registry tools and creates and reads a thread and reply", async () => {
  const { ctx, handler, client } = setup();
  const auth = getAuth(ctx);
  const signup = await auth.api.signUpEmail({
    body: {
      name: "Alice",
      username: "Alice",
      email: "alice@example.test",
      password: "password123",
    },
    asResponse: true,
  });
  const cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const signedIn = await auth.api.signInEmail({
    body: { email: "alice@example.test", password: "password123" },
    asResponse: true,
  });
  const sessionCookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  expect(cookie).toContain("sermo.session_token");
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const forum = await execute(ctx, nodesCreateOp, admin, {
    parentId: null,
    type: "forum",
    title: "General",
  });
  const key = await auth.api.createApiKey({
    headers: new Headers({ cookie: sessionCookie }),
    body: { name: "mcp-test" },
  });
  const { mcp, transport } = client(`Bearer ${key.key}`);
  await mcp.connect(transport);
  try {
    const { tools } = await mcp.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      operations.map((op) => op.name.replaceAll(".", "_")).sort(),
    );
    for (const op of operations) {
      const tool = tools.find((item) => item.name === op.name.replaceAll(".", "_"))!;
      expect(tool.description).toBe(op.summary);
      expect(tool.annotations?.readOnlyHint).toBe(op.kind === "read");
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.inputSchema).toEqual(
        z.toJSONSchema(op.input, { io: "input" }) as typeof tool.inputSchema,
      );
      expect(tool.outputSchema?.type).toBe("object");
    }
    const created = (await mcp.callTool({
      name: "threads_create",
      arguments: { nodeId: forum.id, title: "Hello", body: "First post" },
    })) as CallToolResult;
    expect(created.isError).not.toBe(true);
    if (!created.structuredContent) throw new Error("Missing thread result");
    const thread = created.structuredContent.thread as { id: number };
    expect(thread.id).toBeGreaterThan(0);
    const reply = (await mcp.callTool({
      name: "posts_create",
      arguments: { threadId: thread.id, body: "A reply" },
    })) as CallToolResult;
    expect(reply.isError).not.toBe(true);
    const listed = (await mcp.callTool({
      name: "posts_list",
      arguments: { threadId: thread.id },
    })) as CallToolResult;
    if (!listed.structuredContent) throw new Error("Missing posts result");
    expect((listed.structuredContent.items as { id: number }[]).map((post) => post.id)).toEqual([
      (created.structuredContent.post as { id: number }).id,
      (reply.structuredContent as { id: number }).id,
    ]);
    expect(JSON.parse((listed.content[0] as { text: string }).text)).toEqual(
      listed.structuredContent,
    );

    await auth.api.deleteApiKey({
      headers: new Headers({ cookie: sessionCookie }),
      body: { keyId: key.id },
    });
    await expect(
      mcp.callTool({ name: "threads_get", arguments: { threadId: thread.id } }),
    ).rejects.toThrow("Streamable HTTP error");
    expect(ctx.views.has(thread.id)).toBe(false);
    const response = await handler(
      new Request("http://localhost:3000/mcp", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key.key}`,
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "nodes_list", arguments: {} },
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect((await response.json()).error).toBeDefined();
  } finally {
    await mcp.close();
  }
});

test("guest, member, validation and HTTP method errors preserve boundaries", async () => {
  const { ctx, handler, client } = setup();
  const guest = client();
  await guest.mcp.connect(guest.transport);
  try {
    const result = (await guest.mcp.callTool({
      name: "threads_create",
      arguments: { nodeId: 1, title: "Hello", body: "Text" },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(errorCode(result).code).toBe("unauthenticated");
  } finally {
    await guest.mcp.close();
  }
  const member = insertUser(ctx);
  const memberHandler = createMcpHandler({
    ctx,
    resolveActor: async () => ({ actor: userActor(member), setCookies: [] }),
  });
  const post = async (name: string, args: object) => {
    const response = await memberHandler(
      new Request("http://localhost:3000/mcp", {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
    );
    return (await response.json()).result;
  };
  expect(
    errorCode(await post("nodes_create", { parentId: null, type: "forum", title: "F" })).code,
  ).toBe("forbidden");
  const invalid = errorCode(
    await post("conversations_create", {
      recipientIds: [999999],
      title: "Hello",
      body: "Text",
    }),
  );
  expect(invalid.code).toBe("validation");
  expect(invalid.issues).toBeDefined();
  for (const method of ["GET", "DELETE"]) {
    const response = await handler(new Request("http://localhost:3000/mcp", { method }));
    expect(response.status).toBe(405);
    expect((await response.json()).error).toBeDefined();
  }
  const bad = await handler(
    new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer invalid" },
    }),
  );
  expect(bad.status).toBe(401);
});

test("schema errors, unknown tools, guest reads and internal errors use tool envelopes", async () => {
  const { ctx, handler } = setup();
  const call = async (name: string, args: object) => {
    const response = await post(handler, requestBody("tools/call", { name, arguments: args }));
    expect(response.status).toBe(200);
    return (await response.json()).result as CallToolResult;
  };
  const guestRead = await call("nodes_list", {});
  expect(guestRead.isError).not.toBe(true);
  expect(guestRead.structuredContent?.items).toEqual([]);
  for (const args of [
    { title: "Missing node and body" },
    { nodeId: "bad", title: "T", body: "B" },
  ]) {
    const result = await call("threads_create", args);
    expect(result.isError).toBe(true);
    const error = errorCode(result);
    expect(error.code).toBe("validation");
    expect(error.issues?.length).toBeGreaterThan(0);
  }
  expect(errorCode(await call("missing_tool", {})).code).toBe("not_found");

  const broken = createTestContext();
  const brokenHandler = createMcpHandler({
    ctx: broken,
    resolveActor: async () => ({ actor: GUEST, setCookies: [] }),
  });
  broken.sqlite.close();
  const response = await post(
    brokenHandler,
    requestBody("tools/call", {
      name: "nodes_list",
      arguments: {},
    }),
  );
  const result = (await response.json()).result as CallToolResult;
  expect(result.isError).toBe(true);
  expect(errorCode(result)).toEqual({ code: "internal", message: "An internal error occurred." });
  expect((result.content[0] as { text: string }).text).not.toContain("SQLite");
  ctx.sqlite.close();
});

test("actor resolves once per HTTP request and all refreshed cookies are returned", async () => {
  const ctx = createTestContext();
  let resolutions = 0;
  const cookies = ["session=one; Path=/", "cache=two; Path=/"];
  const handler = createMcpHandler({
    ctx,
    resolveActor: async () => {
      resolutions++;
      return { actor: GUEST, setCookies: cookies };
    },
  });
  const response = await post(handler, [
    requestBody("tools/list", undefined, 1),
    requestBody("tools/call", { name: "nodes_list", arguments: {} }, 2),
  ]);
  expect(response.status).toBe(200);
  expect(resolutions).toBe(1);
  expect(response.headers.getSetCookie()).toEqual(cookies);
  const results = await response.json();
  expect(results).toHaveLength(2);
  expect(results[1].result.structuredContent.items).toEqual([]);
});

test("bad and disabled API keys reject a real call before an operation runs", async () => {
  const { ctx, handler } = setup();
  const auth = getAuth(ctx);
  const signup = await auth.api.signUpEmail({
    body: { name: "Bob", username: "Bob", email: "bob@example.test", password: "password123" },
    asResponse: true,
  });
  const cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const key = await auth.api.createApiKey({
    headers: new Headers({ cookie }),
    body: { name: "mcp" },
  });
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const forum = await execute(ctx, nodesCreateOp, admin, {
    parentId: null,
    type: "forum",
    title: "F",
  });
  const thread = await execute(ctx, operations.find((op) => op.name === "threads.create")!, admin, {
    nodeId: forum.id,
    title: "Thread",
    body: "Body",
  });
  const threadId = (thread as { thread: { id: number } }).thread.id;
  const call = requestBody("tools/call", { name: "threads_get", arguments: { threadId } });
  for (const authorization of ["Bearer invalid", `Bearer ${key.key}`]) {
    if (authorization.includes(key.key))
      ctx.sqlite.prepare("UPDATE auth_apikey SET enabled = 0 WHERE id = ?1").run(Number(key.id));
    const response = await post(handler, call, { Authorization: authorization });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect((await response.json()).error).toBeDefined();
    expect(ctx.views.has(threadId)).toBe(false);
  }
});
