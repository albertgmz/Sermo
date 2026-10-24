"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import {
  LINK_COPIED,
  saidNotice,
  subscribe,
} from "@/components/forum/notice-store";
import { NoticeView } from "@/components/forum/notice-view";

// What a Share button says once it copied a link, wherever on the page it was pressed: the
// floating notice (`shareLink` says it). The main layout holds it, so it is on every page: it
// brings only the store and the notice's view, whose card comes with the first link copied.
export function ShareNotice() {
  const t = useTranslations("forum.shareButton");
  const now = useSyncExternalStore(subscribe, saidNotice, () => null);
  return (
    <NoticeView
      text={now?.notice === LINK_COPIED ? t("copied") : null}
      seq={now?.seq ?? 0}
    />
  );
}
