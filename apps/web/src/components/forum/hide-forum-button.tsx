"use client";

import { EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { hideFeedForum } from "@/app/[locale]/(main)/_feed/filter-actions";

// Keeps the forum of a feed card out of the member's own feed. The page is drawn again, so the
// forum's cards go; the filters sheet shows the forum again.
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
          if (answer?.ok) router.refresh();
          else if (answer && "signIn" in answer && answer.signIn)
            router.push(answer.signIn);
          else setFailed(true);
        })
      }
      className={className}
    >
      <EyeOff aria-hidden="true" />
    </button>
  );
}
