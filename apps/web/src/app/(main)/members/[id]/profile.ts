import { awardsMember, profilesGet } from "@sermo/core/contracts";
import { notFound } from "next/navigation";
import { cache } from "react";
import { read } from "@/lib/sermo/client";

// A member is addressed by the backend's id; anything else is a page that does not exist.
export function memberIdOf(raw: string) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  return id;
}

// Asked once per request for the metadata and the page. A private or missing profile is the 404.
export const getProfile = cache((userId: number) =>
  read(profilesGet, { userId }),
);

export const getHeldAwards = cache((userId: number) =>
  read(awardsMember, { userId }),
);

export type Profile = Awaited<ReturnType<typeof getProfile>>;
