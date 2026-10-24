"use server";

import { standingsMonth, WIDGET_OPTIONS } from "@sermo/core/contracts";
import { monthParts } from "@/components/widgets/month-standings";
import type { MonthParts } from "@/components/widgets/month-standings-card";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { getViewer } from "@/lib/sermo/session";

// The part of the month-of-the-month card that follows the month, drawn as the widget draws it,
// for the picker that changes the month in place (`MonthStandingsCard`). `limit` is the widget's
// and `month` the one chosen (`YYYY-MM`); both come from the browser, so both are checked here.
// Null for anything else, or when the backend refuses: the browser then opens the month's page.
export async function monthStandingsPart(
  limit: number,
  month: string,
): Promise<MonthParts | null> {
  const wanted = WIDGET_OPTIONS.monthStandings.shape.limit.safeParse(limit);
  if (!wanted.success || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month)))
    return null;
  try {
    const [standing, { user }] = await Promise.all([
      call(standingsMonth, { month, limit: wanted.data }),
      getViewer(),
    ]);
    return await monthParts(standing, user?.id);
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
}
