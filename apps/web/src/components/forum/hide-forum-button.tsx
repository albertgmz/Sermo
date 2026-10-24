"use client";

import { EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { hideFeedForum } from "@/app/[locale]/(main)/_feed/filter-actions";
import { useTabSwitch } from "@/components/forum/tab-switch-context";

// Keeps the forum of a feed card out of the member's own feed. The feed is drawn again in place
// (its switch, `TabSwitch`), so the forum's cards leave every page of it held; elsewhere the page
// is drawn again. The filters sheet shows the forum again.
export function HideForumButton({
  nodeId,
  title,
  className,
}: {
  nodeId: number;
  title: string;
  // The look of the card's other actions, given by the card.
  className: string;
}) {
  const t = useTranslations("forum.hideForumButton");
  const router = useRouter();
  const switching = useTabSwitch();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const label = t("label", { title });
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={label}
      title={failed ? t("failed") : label}
      onClick={() =>
        start(async () => {
          setFailed(false);
          const answer = await hideFeedForum(nodeId, true).catch(() => null);
          if (answer?.ok) {
            if (switching) switching.reload();
            else router.refresh();
          } else if (answer && "signIn" in answer && answer.signIn)
            router.push(answer.signIn);
          else setFailed(true);
        })
      }
      className={className}
    >
      <EyeOff aria-hidden="true" />
      <span role="status" className="sr-only">
        {failed ? t("failed") : ""}
      </span>
    </button>
  );
}
