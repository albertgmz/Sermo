import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  MAX_BATCH_SIZE,
  requestBodyTooLargeMessage,
} from "@modelcontextprotocol/sdk/server/requestBody.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isJsonContentType } from "@modelcontextprotocol/sdk/shared/mediaType.js";
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
  _zod: {
    optin?: "optional" | "defaulted";
    def: {
      type: string;
      format?: string;
      coerce?: boolean;
      in?: ZodNode;
      shape?: Record<string, ZodNode>;
      items?: ZodNode[];
      checks?: { _zod: { def: Record<string, unknown> } }[];
    };
  };
};

/** Zod URL checks normalize implicitly; overwrites can change any string constraint. */
function transformsString(schema: ZodNode): boolean {
  const def = schema._zod.def;
  return (
    def.format === "url" ||
    (def.checks ?? []).some(
      (check) => check._zod.def.check === "overwrite" || check._zod.def.format === "url",
    )
  );
}

function describeNormalization(schema: Record<string, unknown>, rawType?: unknown) {
  const { description, ...constraints } = schema;
  for (const key of Object.keys(schema)) delete schema[key];
  if (rawType) schema.type = rawType;
  schema.description = [
    description,
    `Validated after normalization: ${JSON.stringify(constraints)}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The JSON Schema published for an operation's input. It must never reject input the server
 * accepts: constraints on normalized strings move into the description because JSON Schema
 * validates the raw input. Preprocessors can accept any input type. A refinement forbidding 0
 * is published as `not: { const: 0 }`.
 */
export function toolInputSchema(op: Operation) {
  return z.toJSONSchema(op.input, {
    io: "input",
    // The SDK's default AJV provider supports Draft 7, including tuple item schemas.
    target: "draft-07",
    override: ({ zodSchema, jsonSchema }) => {
      const node = zodSchema as unknown as ZodNode;
      const type = node._zod.def.type;
      if (
        node._zod.def.coerce ||
        (type === "pipe" && node._zod.def.in?._zod.def.type === "transform")
      ) {
        // Zod emits the output schema for a preprocessor even in input mode. Its constraints
        // cannot describe the raw input, so keep them as guidance for the server-side check.
        describeNormalization(jsonSchema);
      } else if (type === "string" && transformsString(node)) {
        const notes: string[] = [];
        if (typeof jsonSchema.minLength === "number")
          notes.push(`At least ${jsonSchema.minLength} characters after normalization.`);
        if (typeof jsonSchema.maxLength === "number")
          notes.push(`At most ${jsonSchema.maxLength} characters after normalization.`);
        if (typeof jsonSchema.pattern === "string")
          notes.push(`Must match ${jsonSchema.pattern} after normalization.`);
        if (typeof jsonSchema.format === "string")
          notes.push(`Format: ${jsonSchema.format} after normalization.`);
        if (jsonSchema.allOf)
          notes.push(`Must satisfy ${JSON.stringify(jsonSchema.allOf)} after normalization.`);
        delete jsonSchema.minLength;
        delete jsonSchema.maxLength;
        delete jsonSchema.pattern;
        delete jsonSchema.format;
        delete jsonSchema.allOf;
        delete jsonSchema.contentEncoding;
        if (notes.length)
          jsonSchema.description = [jsonSchema.description, ...notes].filter(Boolean).join(" ");
      } else if (node._zod.def.checks?.some((check) => check._zod.def.check === "overwrite")) {
        // Overwrites preserve the base input type, but may change size or numeric limits
        // (including turning a fractional input into an integer).
        describeNormalization(jsonSchema, type === "number" ? "number" : jsonSchema.type);
      } else if (type === "object" && jsonSchema.required) {
        // The emitter uses declared optionality; runtime preprocessors can fill absent keys.
        jsonSchema.required = jsonSchema.required.filter(
          (key) => node._zod.def.shape?.[key]?._zod.optin === undefined,
        );
      } else if (type === "tuple" && node._zod.def.items) {
        let required = node._zod.def.items.length;
        while (required > 0 && node._zod.def.items[required - 1]?._zod.optin !== undefined)
          required--;
        jsonSchema.minItems = required;
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

const clientClosed = () => rpcError(499, -32000, "Client closed the request.");

/** Bound both bytes and time, and release the reader even if its source never settles cancel(). */
async function parseRequestBody(
  request: Request,
  timeoutMs: number,
): Promise<{ parsedBody: unknown } | Response> {
  if (request.signal.aborted) return clientClosed();
  if (Number(request.headers.get("content-length")) > DEFAULT_MAX_REQUEST_BODY_SIZE)
    return rpcError(413, -32000, requestBodyTooLargeMessage(DEFAULT_MAX_REQUEST_BODY_SIZE));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let onAbort: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<Response>((resolve) => {
    onAbort = () => resolve(clientClosed());
    request.signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => resolve(rpcError(408, -32000, "Request body timed out.")), timeoutMs);
  });
  const read = async () => {
    try {
      reader = request.body?.getReader();
      const decoder = new TextDecoder();
      let text = "";
      let bytes = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > DEFAULT_MAX_REQUEST_BODY_SIZE)
          return rpcError(413, -32000, requestBodyTooLargeMessage(DEFAULT_MAX_REQUEST_BODY_SIZE));
        text += decoder.decode(value, { stream: true });
      }
      return { parsedBody: JSON.parse(text + decoder.decode()) as unknown };
    } catch {
      return rpcError(400, -32700, "Parse error: Invalid JSON");
    }
  };
  try {
    return await Promise.race([read(), stopped]);
  } finally {
    clearTimeout(timer);
    if (onAbort) request.signal.removeEventListener("abort", onAbort);
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

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
  /** Total time allowed to receive a body, in milliseconds (default: 30 seconds). */
  requestBodyTimeoutMs?: number;
  /** Called once per tool call, before it runs; false answers that call with a rate-limit error. */
  allowCall?: (
    request: Request,
    op: { name: string; kind: "read" | "write" },
  ) => boolean | Promise<boolean>;
}): (request: Request) => Promise<Response> {
  const requestBodyTimeoutMs = options.requestBodyTimeoutMs ?? 30_000;
  if (!Number.isFinite(requestBodyTimeoutMs) || requestBodyTimeoutMs <= 0)
    throw new RangeError("requestBodyTimeoutMs must be positive and finite.");
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

    const response = await handleResolved(request, resolved.actor);
    if (!resolved.setCookies.length) return response;
    const headers = new Headers(response.headers);
    for (const cookie of resolved.setCookies) headers.append("Set-Cookie", cookie);
    return new Response(response.body, { status: response.status, headers });
  };

  async function handleResolved(request: Request, actor: Actor): Promise<Response> {
    const malformed = new Set<unknown>();
    const server = new Server({ name: "sermo", version: "0.1.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
    server.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
      try {
        const op = byToolName.get(call.params.name);
        if (!op) throw new NotFoundError("The requested tool could not be found.");
        if (options.allowCall && !(await options.allowCall(request, op))) return rateLimitedError;
        extra.signal.throwIfAborted();
        if (malformed.has(extra.requestId))
          throw new ValidationError("Tool arguments must be an object.");
        const args = call.params.arguments;
        const output = await execute(options.ctx, op, actor, args);
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
      // Match the SDK's header gate and let the transport produce its own error response,
      // without consuming even one body byte. Accept takes precedence over Content-Type.
      const accept = request.headers.get("accept");
      if (
        !accept?.includes("application/json") ||
        !accept.includes("text/event-stream") ||
        !isJsonContentType(request.headers.get("content-type"))
      )
        return await transport.handleRequest(request);
      const body = await parseRequestBody(request, requestBodyTimeoutMs);
      if (body instanceof Response) return body;
      if (request.signal.aborted) return clientClosed();
      const { parsedBody } = body;
      if (Array.isArray(parsedBody)) {
        if (parsedBody.length > MAX_BATCH_SIZE)
          return rpcError(
            400,
            -32600,
            `Invalid Request: Batch must not exceed ${MAX_BATCH_SIZE} messages`,
          );
        // The SDK drops cancelled responses but waits for every request in the batch.
        if ((parsedBody as Rpc[]).some((message) => message?.method === "notifications/cancelled"))
          return rpcError(400, -32600, "Batches must not contain notifications/cancelled.");
        const ids = new Set<unknown>();
        for (const message of parsedBody as Rpc[]) {
          if (!message || typeof message !== "object" || !("id" in message)) continue;
          if (ids.has(message.id))
            return rpcError(400, -32600, "Invalid Request: Duplicate request id in batch.");
          ids.add(message.id);
        }
        for (const message of parsedBody) takeMalformedArguments(message, malformed);
      } else {
        takeMalformedArguments(parsedBody, malformed);
      }
      const aborted = new Promise<Response>((resolve) => {
        onAbort = () => resolve(clientClosed());
        if (request.signal.aborted) onAbort();
        else request.signal.addEventListener("abort", onAbort, { once: true });
      });
      const pending = transport.handleRequest(request, { parsedBody });
      pending.catch(() => {});
      return await Promise.race([pending, aborted]);
    } finally {
      if (onAbort) request.signal.removeEventListener("abort", onAbort);
      await server.close();
    }
  }
}
