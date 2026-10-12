import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import {
  blocks,
  LITE_COOKIE,
  type LiteCategory,
  parseLiteCookie,
} from "@/lib/lite-preferences";

export const getLiteCookieValue = cache(async () => {
  return (await cookies()).get(LITE_COOKIE)?.value ?? "";
});

export const getLiteState = cache(async () => {
  return parseLiteCookie(await getLiteCookieValue());
});

export const liteBlocks = cache(async (category: LiteCategory) => {
  return blocks(await getLiteState(), category);
});
