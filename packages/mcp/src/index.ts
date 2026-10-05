import type { Actor, Ctx } from "@sermo/core";

/** MCP endpoint handler (Streamable HTTP). Placeholder until the MCP adapter is implemented. */
export function createMcpHandler(_options: {
  ctx: Ctx;
  /** Resolves the caller from the HTTP request; rejects with UnauthenticatedError for a bad credential. */
  resolveActor: (request: Request) => Promise<Actor>;
}): (request: Request) => Promise<Response> {
  return async () => new Response("Not implemented", { status: 501 });
}
