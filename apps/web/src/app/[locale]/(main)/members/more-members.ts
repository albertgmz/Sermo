"use server";

import {
  monthPage,
  monthParam,
} from "@/app/[locale]/(main)/members/month-page";
import { call } from "@/lib/sermo/client";
import { endQuietly } from "@/lib/sermo/list-actions";

// The month is the one the list was drawn for; it comes back from the browser, so it is read as an
// address parameter is.
export async function moreMonth(month: string | null, cursor: string | null) {
  return endQuietly(() =>
    monthPage(cursor ?? undefined, monthParam(month), call),
  );
}
