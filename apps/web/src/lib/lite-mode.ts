import "server-only";

import { cookies, headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { stripBbCodeImages } from "@/lib/lite-content";
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

// What stands in for a blocked picture, in the visitor's language.
export const getLiteLabel = cache(async () => {
  return (await getTranslations("lite.litePlaceholder"))("label");
});

export const getLiteOrigin = cache(async () => {
  const request = await headers();
  const host = request.get("x-forwarded-host") ?? request.get("host");
  const protocol = request.get("x-forwarded-proto") ?? "http";
  return host ? `${protocol}://${host}` : undefined;
});

export async function filterLiteBbCode(source: string): Promise<string> {
  const [state, origin, label] = await Promise.all([
    getLiteState(),
    getLiteOrigin(),
    getLiteLabel(),
  ]);
  return stripBbCodeImages(source, state, origin, label);
}
