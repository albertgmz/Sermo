"use server";

import { profilesGet } from "@sermo/core/contracts";
import type { ReactNode } from "react";
import { ProfileSections } from "@/app/[locale]/(main)/members/[id]/sections";
import { pageParam } from "@/components/forum/page-window";
import { queryOfSearch } from "@/components/forum/places";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { requireIds } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";

// The sections of a profile as the address with `search` draws them, for a tab pressed (`TabSwitch`).
// The profile is read again, as a page load reads it: what the viewer may see is the backend's
// answer of now. Null when there is nothing to show in place (the profile is gone or closed to the
// viewer, the backend refuses): the browser then opens the address as a page of its own.
export async function profileSections(
  userId: number,
  search: string,
): Promise<ReactNode | null> {
  requireIds(userId);
  if (typeof search !== "string") return null;
  try {
    const [profile, viewer] = await Promise.all([
      call(profilesGet, { userId }),
      getViewer(),
    ]);
    // Awaited here, so that a refusal is this answer's and not a broken part of the page.
    const query = queryOfSearch(search);
    return await ProfileSections({
      profile,
      query,
      viewer,
      page: pageParam(query.page),
      inPlace: true,
    });
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
}
