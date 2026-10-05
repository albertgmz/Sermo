import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  type Actor,
  type Ctx,
  execute,
  NotFoundError,
  operations,
  SermoError,
  UnauthenticatedError,
} from "@sermo/core";
import * as z from "zod";

function rpcError(status: number, code: number, message: string, headers?: HeadersInit): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers });
}

function toolError(error: unknown) {
  const detail =
    error instanceof SermoError
      ? {
          code: error.code,
          message: error.message,
          ...(error.issues ? { issues: error.issues } : {}),
        }
      : { code: "internal", message: "An internal error occurred." };
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ error: detail }) }],
  };
}

/** Serve the core operation registry as stateless Streamable HTTP tools. */
export function createMcpHandler(options: {
  ctx: Ctx;
  /** Resolves the caller from the HTTP request (API key or session cookie); rejects with UnauthenticatedError. */
  resolveActor: (request: Request) => Promise<{ actor: Actor; setCookies: string[] }>;
}): (request: Request) => Promise<Response> {
  const tools = operations.map((op) => ({
    name: op.name.replaceAll(".", "_"),
    description: op.summary,
    inputSchema: z.toJSONSchema(op.input, { io: "input" }),
    // Named output objects become root $refs; MCP requires an object at the root.
    outputSchema: z.toJSONSchema(z.object(op.output.shape), { io: "output" }),
    annotations: { readOnlyHint: op.kind === "read", destructiveHint: false },
  }));
  const byToolName = new Map(operations.map((op) => [op.name.replaceAll(".", "_"), op]));

  return async (request) => {
    if (request.method !== "POST") return rpcError(405, -32000, "Method not allowed.");

    let resolved: { actor: Actor; setCookies: string[] };
    try {
      resolved = await options.resolveActor(request);
    } catch (error) {
      if (error instanceof UnauthenticatedError)
        return rpcError(401, -32001, error.message, { "WWW-Authenticate": "Bearer" });
      return rpcError(500, -32603, "An internal error occurred.");
    }

    const server = new Server({ name: "sermo", version: "0.1.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      try {
        const op = byToolName.get(call.params.name);
        if (!op) throw new NotFoundError("The requested tool could not be found.");
        const output = await execute(options.ctx, op, resolved.actor, call.params.arguments);
        return {
          structuredContent: output,
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
        };
      } catch (error) {
        return toolError(error);
      }
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      if (!resolved.setCookies.length) return response;
      const headers = new Headers(response.headers);
      for (const cookie of resolved.setCookies) headers.append("Set-Cookie", cookie);
      return new Response(response.body, { status: response.status, headers });
    } finally {
      await server.close();
    }
  };
}
