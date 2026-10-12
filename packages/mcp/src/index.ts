import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  MAX_BATCH_SIZE,
  readRequestBody,
  requestBodyTooLargeMessage,
} from "@modelcontextprotocol/sdk/server/requestBody.js";
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
  ValidationError,
} from "@sermo/core";
import * as z from "zod";

type Operation = (typeof operations)[number];

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

const rateLimitedError = {
  isError: true as const,
  content: [
    {
      type: "text" as const,
      text: JSON.stringify({ error: { code: "rate_limited", message: "Too many requests." } }),
    },
  ],
};

type ZodNode = {
  _zod: { def: { type: string; checks?: { _zod: { def: Record<string, unknown> } }[] } };
};

/** Whether a string schema trims its input (`.trim()`) before applying its other limits. */
function trimsInput(schema: ZodNode): boolean {
  return (schema._zod.def.checks ?? []).some((check) => {
    const def = check._zod.def;
    return def.check === "overwrite" && (def.tx as (value: string) => string)(" a ") === "a";
  });
}

/**
 * The JSON Schema published for an operation's input. It must never reject input the server
 * accepts: the server trims strings before measuring them, so length and pattern limits on
 * trimmed strings move into the description, and a number that a refinement forbids from being 0
 * is published as `not: { const: 0 }`.
 */
export function toolInputSchema(op: Operation) {
  return z.toJSONSchema(op.input, {
    io: "input",
    override: ({ zodSchema, jsonSchema }) => {
      const node = zodSchema as unknown as ZodNode;
      const type = node._zod.def.type;
      if (type === "string" && trimsInput(node)) {
        const notes: string[] = [];
        if (typeof jsonSchema.maxLength === "number")
          notes.push(`At most ${jsonSchema.maxLength} characters after trimming.`);
        if (typeof jsonSchema.pattern === "string")
          notes.push(`Must match ${jsonSchema.pattern} after trimming.`);
        delete jsonSchema.maxLength;
        delete jsonSchema.pattern;
        delete jsonSchema.format;
        if (notes.length)
          jsonSchema.description = [jsonSchema.description, ...notes].filter(Boolean).join(" ");
      } else if (type === "number" && !z.safeParse(zodSchema, 0).success) {
        const { minimum, maximum } = jsonSchema;
        if ((minimum === undefined || minimum <= 0) && (maximum === undefined || maximum >= 0))
          jsonSchema.not = { const: 0 };
      }
    },
  });
}

/**
 * Tool hints from the operation list. Reads are read-only. Writes are destructive when their
 * name ends in `delete` or `remove`; for other writes the hint is omitted (the protocol then
 * assumes the worst) because the operation list does not say whether they overwrite data.
 */
function toolAnnotations(op: Operation) {
  if (op.kind === "read") return { readOnlyHint: true };
  return /\.(delete|remove)$/.test(op.name)
    ? { readOnlyHint: false, destructiveHint: true }
    : { readOnlyHint: false };
}

type Rpc = { id?: unknown; method?: unknown; params?: unknown };

/**
 * The SDK validates `tools/call` params before our handler runs and answers with its own
 * diagnostics. A call whose `arguments` is not an object is rewritten to carry `{}`, and the
 * request id is remembered so the handler can report a validation error.
 */
function takeMalformedArguments(message: unknown, malformed: Set<unknown>) {
  const call = message as Rpc | null;
  if (!call || typeof call !== "object" || call.method !== "tools/call") return;
  const params = call.params as { arguments?: unknown } | null;
  if (!params || typeof params !== "object" || !("arguments" in params)) return;
  const args = params.arguments;
  if (args === undefined || (typeof args === "object" && args !== null && !Array.isArray(args)))
    return;
  malformed.add(call.id);
  params.arguments = {};
}

/** Serve the core operation registry as stateless Streamable HTTP tools. */
export function createMcpHandler(options: {
  ctx: Ctx;
  /** Resolves the caller from the HTTP request (API key or session cookie); rejects with UnauthenticatedError. */
  resolveActor: (request: Request) => Promise<{ actor: Actor; setCookies: string[] }>;
  /** Called once per tool call, before it runs; false answers that call with a rate-limit error. */
  allowCall?: (
    request: Request,
    op: { name: string; kind: "read" | "write" },
  ) => boolean | Promise<boolean>;
}): (request: Request) => Promise<Response> {
  const tools = operations.map((op) => ({
    name: op.name.replaceAll(".", "_"),
    description: op.summary,
    inputSchema: toolInputSchema(op),
    // Named output objects become root $refs; MCP requires an object at the root.
    outputSchema: z.toJSONSchema(z.object(op.output.shape), { io: "output" }),
    annotations: toolAnnotations(op),
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

    let parsedBody: unknown;
    try {
      const body = await readRequestBody(request);
      if (body.tooLarge)
        return rpcError(413, -32000, requestBodyTooLargeMessage(DEFAULT_MAX_REQUEST_BODY_SIZE));
      parsedBody = JSON.parse(body.text);
    } catch {
      return rpcError(400, -32700, "Parse error: Invalid JSON");
    }
    const malformed = new Set<unknown>();
    if (Array.isArray(parsedBody)) {
      if (parsedBody.length > MAX_BATCH_SIZE)
        return rpcError(
          400,
          -32600,
          `Invalid Request: Batch must not exceed ${MAX_BATCH_SIZE} messages`,
        );
      // The SDK drops the response of a cancelled request but the transport waits for it, so
      // such a batch would never complete. Rejecting it is simpler than settling entries by hand.
      if ((parsedBody as Rpc[]).some((message) => message?.method === "notifications/cancelled"))
        return rpcError(400, -32600, "Batches must not contain notifications/cancelled.");
      for (const message of parsedBody) takeMalformedArguments(message, malformed);
    } else {
      takeMalformedArguments(parsedBody, malformed);
    }

    const server = new Server({ name: "sermo", version: "0.1.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
    server.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
      try {
        const op = byToolName.get(call.params.name);
        if (!op) throw new NotFoundError("The requested tool could not be found.");
        if (options.allowCall && !(await options.allowCall(request, op))) return rateLimitedError;
        if (malformed.has(extra.requestId))
          throw new ValidationError("Tool arguments must be an object.");
        const args = call.params.arguments;
        const output = await execute(options.ctx, op, resolved.actor, args);
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
    let onAbort: (() => void) | undefined;
    try {
      await server.connect(transport);
      const aborted = new Promise<Response>((resolve) => {
        onAbort = () => resolve(rpcError(499, -32000, "Client closed the request."));
        if (request.signal.aborted) onAbort();
        else request.signal.addEventListener("abort", onAbort, { once: true });
      });
      const pending = transport.handleRequest(request, { parsedBody });
      pending.catch(() => {});
      const response = await Promise.race([pending, aborted]);
      if (!resolved.setCookies.length) return response;
      const headers = new Headers(response.headers);
      for (const cookie of resolved.setCookies) headers.append("Set-Cookie", cookie);
      return new Response(response.body, { status: response.status, headers });
    } finally {
      if (onAbort) request.signal.removeEventListener("abort", onAbort);
      await server.close();
    }
  };
}
