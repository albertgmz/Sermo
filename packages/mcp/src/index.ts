import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  type Actor,
  type Ctx,
  execute,
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
  resolveActor: (request: Request) => Promise<Actor>;
}): (request: Request) => Promise<Response> {
  const definitions = operations.map((op) => ({
    op,
    name: op.name.replaceAll(".", "_"),
    config: {
      title: op.name,
      description: op.summary,
      inputSchema: op.input,
      // A named root object becomes a $ref in the SDK's JSON Schema output. MCP requires
      // an object at the root, so reuse the contract's shape without its root metadata.
      outputSchema: z.object(op.output.shape),
      annotations: { readOnlyHint: op.kind === "read", destructiveHint: false },
    },
  }));

  return async (request) => {
    if (request.method !== "POST") return rpcError(405, -32000, "Method not allowed.");

    let actor: Actor;
    try {
      actor = await options.resolveActor(request);
    } catch (error) {
      if (error instanceof UnauthenticatedError)
        return rpcError(401, -32001, error.message, { "WWW-Authenticate": "Bearer" });
      return rpcError(500, -32603, "An internal error occurred.");
    }

    const server = new McpServer({ name: "sermo", version: "0.1.0" });
    for (const { op, name, config } of definitions) {
      server.registerTool(name, config, async (input: unknown) => {
        try {
          const output = await execute(options.ctx, op, actor, input);
          return {
            structuredContent: output,
            content: [{ type: "text" as const, text: JSON.stringify(output) }],
          };
        } catch (error) {
          return toolError(error);
        }
      });
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request, {
        authInfo: {
          token: "",
          clientId: actor.kind === "guest" ? "guest" : String(actor.userId),
          scopes: [],
        },
      });
    } finally {
      await server.close();
    }
  };
}
