import "server-only";

import { cookies, headers } from "next/headers";
import { cache } from "react";
import { stripMarkdownImages } from "@/lib/lite-markdown";
import {
  blocks,
  type LiteCategory,
  parseLiteCookieHeader,
  serializeLiteCookie,
} from "@/lib/lite-preferences";

export const getLiteCookieValue = cache(async () => {
  return serializeLiteCookie(await getLiteState());
});

export const getLiteState = cache(async () => {
  return parseLiteCookieHeader((await cookies()).toString());
});

export const liteBlocks = cache(async (category: LiteCategory) => {
  return blocks(await getLiteState(), category);
});

export const getLiteOrigin = cache(async () => {
  const request = await headers();
  const host = request.get("x-forwarded-host") ?? request.get("host");
  const protocol = request.get("x-forwarded-proto") ?? "http";
  return host ? `${protocol}://${host}` : undefined;
});

export async function filterLiteMarkdown(markdown: string): Promise<string> {
  const [state, origin] = await Promise.all([getLiteState(), getLiteOrigin()]);
  return stripMarkdownImages(markdown, state, origin);
}
