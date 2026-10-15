import { threadsFeatured } from "@sermo/core/contracts";
import { Megaphone, Star } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ThreadTitle } from "@/app/[locale]/(main)/_feed/thread-title";
import { SectionCard } from "@/components/forum/section-card";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { threadMembers } from "@/lib/sermo/threads";

// How many featured threads the home page lists.
const FEATURED_SIZE = 3;

// The threads featured right now, newest feature first: staff picks and paid promotions. Nothing
// is drawn when there are none.
export async function FeaturedThreads() {
  const { items } = await read(threadsFeatured, { limit: FEATURED_SIZE });
  if (items.length === 0) return null;
  const [member, t] = await Promise.all([
    membersFor(items.flatMap(({ thread }) => threadMembers(thread))),
    getTranslations("home.featured"),
  ]);
  return (
    <SectionCard title={t("title")}>
      {items.map(({ kind, thread }) => {
        const Mark = kind === "paid" ? Megaphone : Star;
        return (
          <div key={thread.id} className="px-4 py-2.5">
            <ThreadTitle thread={thread} member={member} />
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 font-medium text-primary-ink">
                <Mark aria-hidden="true" className="size-3" />
                {t(kind === "paid" ? "promoted" : "featured")}
              </span>{" "}
              · {thread.node.title}
            </p>
          </div>
        );
      })}
    </SectionCard>
  );
}
