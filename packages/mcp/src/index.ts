import type { Actor, Ctx } from "@sermo/core";

/** MCP endpoint handler (Streamable HTTP). Placeholder until the MCP adapter is implemented. */
export function createMcpHandler(_options: {
  ctx: Ctx;
  resolveActor: (request: Request) => Actor;
}): (request: Request) => Promise<Response> {
  return async () => new Response("Not implemented", { status: 501 });
}
