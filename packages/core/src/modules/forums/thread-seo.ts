import type { Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { ForbiddenError } from "../../errors";
import { can } from "../../permissions";

/** What a moderator set for a thread; a field left out of an update is `undefined`. */
export interface SeoFields {
  seoTitle?: string | null;
  seoDescription?: string | null;
}

export const sendsSeoFields = (input: SeoFields) =>
  input.seoTitle !== undefined || input.seoDescription !== undefined;

/** Only a moderator who may edit any thread in the forum sets what search engines read. */
export function requireSeoEditor(ctx: Ctx, actor: Actor, nodeId: number): void {
  if (!can(ctx, actor, "forum.editAny", { nodeId })) throw new ForbiddenError();
}

/** An empty text means "none": the templates are in charge again. */
const stored = (text: string | null | undefined) => (text ? text : null);

/** Writes the fields the update sent; the other one keeps its value. */
export function writeSeoFields(ctx: Ctx, threadId: number, input: SeoFields): void {
  if (input.seoTitle !== undefined)
    prepared(ctx, "forums.setSeoTitle", () =>
      ctx.sqlite.prepare("UPDATE threads SET seo_title = ?1 WHERE id = ?2"),
    ).run(stored(input.seoTitle), threadId);
  if (input.seoDescription !== undefined)
    prepared(ctx, "forums.setSeoDescription", () =>
      ctx.sqlite.prepare("UPDATE threads SET seo_description = ?1 WHERE id = ?2"),
    ).run(stored(input.seoDescription), threadId);
}

/** The stored fields, for the viewer who may change them; null for everyone else. */
export function seoOverrideFor(
  ctx: Ctx,
  actor: Actor,
  thread: { id: number; node_id: number },
): { title: string | null; description: string | null } | null {
  if (!can(ctx, actor, "forum.editAny", { nodeId: thread.node_id })) return null;
  const row = prepared(ctx, "forums.seoFields", () =>
    ctx.sqlite.prepare<{ seo_title: string | null; seo_description: string | null }, [number]>(
      "SELECT seo_title, seo_description FROM threads WHERE id = ?1",
    ),
  ).get(thread.id);
  return { title: row?.seo_title ?? null, description: row?.seo_description ?? null };
}

/** The fields of an update as the moderator log keeps them. */
export function seoLogDetails(input: SeoFields): Record<string, string | null> {
  return {
    ...(input.seoTitle === undefined ? {} : { seoTitle: stored(input.seoTitle) }),
    ...(input.seoDescription === undefined ? {} : { seoDescription: stored(input.seoDescription) }),
  };
}
