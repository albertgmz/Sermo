import "server-only";

import { type WidgetPage, widgetsCurrent } from "@sermo/core/contracts";
import { cache } from "react";
import type * as z from "zod";
import { call } from "./client";
import { SermoError } from "./errors";

export type ApiWidget = z.output<typeof widgetsCurrent.output>["items"][number];

// The widgets a page draws for the current visitor, in drawing order. Their rules are about the
// viewer, so they are asked with the visitor's cookies, once per request (the page and each of its
// areas share the answer), and never kept in a cache shared between visitors. A backend that cannot
// be reached leaves the page without widgets; anything that is not an API error (the signal that
// this read needs the request) is passed on.
export const getWidgets = cache(
  async (page: z.output<typeof WidgetPage>): Promise<ApiWidget[]> => {
    try {
      return (await call(widgetsCurrent, { page })).items;
    } catch (error) {
      if (!(error instanceof SermoError)) throw error;
      // `next build` prerenders without a backend, so nothing is logged during the build.
      if (process.env.NEXT_PHASE !== "phase-production-build")
        console.error("The widgets could not be read from the API", error);
      return [];
    }
  },
);
