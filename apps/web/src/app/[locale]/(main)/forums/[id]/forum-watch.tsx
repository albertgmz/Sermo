import type { nodesGet } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { setForumWatch } from "@/app/[locale]/(main)/forums/actions";
import { WatchButton } from "@/components/forum/watch-button";

// Watching a forum, from its header: one button whose popover holds new threads or every new post
// and the email choice, saved in place. What the member has chosen comes with the forum
// (`nodes.get`).
export async function ForumWatch({
  nodeId,
  watching,
}: {
  nodeId: number;
  watching: z.output<typeof nodesGet.output>["watching"];
}) {
  const t = await getTranslations("forums.watch");
  return (
    <WatchButton
      item={`forum:${nodeId}`}
      watching={watching}
      label={t("watch")}
      modes
      save={setForumWatch.bind(null, nodeId)}
    />
  );
}
