import "server-only";

import { widgetsList } from "@sermo/core/contracts";
import { cache } from "react";
import type * as z from "zod";
import { read } from "@/lib/sermo/client";

export type WidgetItem = z.output<typeof widgetsList.output>["items"][number];

// Every widget, in the order the lists show them: by position, then the order the pages draw.
export const getWidgetList = cache(
  async () => (await read(widgetsList, {})).items,
);
