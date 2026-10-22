import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";

// A block that fails draws nothing and is logged; the page and the other blocks stand. What Next.js
// throws on purpose (a redirect, a request-time read during a prerender) is passed on.
export async function drawnOrNothing(
  what: string,
  draw: () => ReactNode | Promise<ReactNode>,
): Promise<ReactNode> {
  try {
    return await draw();
  } catch (error) {
    unstable_rethrow(error);
    console.error(`${what} could not be drawn`, error);
    return null;
  }
}
