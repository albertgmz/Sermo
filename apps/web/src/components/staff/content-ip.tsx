import "server-only";

import { ipsContent } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { ClientIcons } from "@/components/forum/client-icons";
import { linkClass } from "@/components/staff/rows";
import { call } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";

export type ContentRef = {
  type: z.input<typeof ipsContent.input>["contentType"];
  id: number;
};

// The address a piece of content was made from, for staff who hold "View IPs": the address links
// to the members who used it. Nothing for anyone else, and nothing when the log holds no address.
export async function ContentIp({ from }: { from: ContentRef | null }) {
  if (!from) return null;
  const viewer = await getViewer();
  if (viewer.resolvedPermissions["member.viewIps"] !== true) return null;
  const [t, { entry }] = await Promise.all([
    getTranslations("moderation.ips"),
    call(ipsContent, { contentType: from.type, contentId: from.id }),
  ]);
  if (!entry) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
      <span>{t("madeFrom")}</span>
      <Link
        href={`/moderation/ips?ip=${encodeURIComponent(entry.ip)}`}
        className={`${linkClass} [overflow-wrap:anywhere]`}
      >
        {entry.ip}
      </Link>
      <ClientIcons client={entry.device} />
    </p>
  );
}
