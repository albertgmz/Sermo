import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

export const LITE_COOKIE = "forum_lite";

export const isLiteMode = cache(async () => {
  return (await cookies()).get(LITE_COOKIE)?.value === "1";
});
