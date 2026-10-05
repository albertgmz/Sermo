import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execute, operations } from "@sermo/core";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { getAuth, resolveActor } from "../../core/src/modules/auth";
import { nodesCreateOp } from "../../core/src/modules/forums";
import { createMcpHandler } from "./index";

function setup() {
  const ctx = createTestContext();
  let resolved = 0;
  const handler = createMcpHandler({
    ctx,
    resolveActor: async (request) => {
      resolved++;
      return (await resolveActor(ctx, request.headers)).actor;
    },
  });
  const client = (authorization?: string) => {
    const mcp = new Client({ name: "sermo-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL("http://localhost:3000/mcp"), {
      requestInit: authorization ? { headers: { Authorization: authorization } } : undefined,
      fetch: (url, init) => handler(new Request(url, init)),
    });
    return { mcp, transport };
  };
  return {
    ctx,
    handler,
    client,
    get resolved() {
      return resolved;
    },
  };
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
      expect(tool.inputSchema.type).toBe("object");
    }
    const start = performance.now();
    const created = (await mcp.callTool({
      name: "threads_create",
      arguments: { nodeId: forum.id, title: "Hello", body: "First post" },
    })) as CallToolResult;
    const roundTripMs = performance.now() - start;
    console.log(`MCP tools/call round trip: ${roundTripMs.toFixed(2)} ms`);
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
  const memberHandler = createMcpHandler({ ctx, resolveActor: async () => userActor(member) });
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
