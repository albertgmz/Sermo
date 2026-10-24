"use client";

import { useTranslations } from "next-intl";
import { PageNotice } from "@/components/forum/page-notice";
import { LINK_COPIED } from "@/components/forum/share-link";

// What a Share button says once it copied a link, wherever on the page it was pressed: the
// floating notice (`shareLink` says it).
export function ShareNotice() {
  const t = useTranslations("forum.shareButton");
  return <PageNotice texts={{ [LINK_COPIED]: t("copied") }} />;
}
