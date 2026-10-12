"use client";

import { useTranslations } from "next-intl";
import { FormRows } from "@/components/staff/form-rows";
import { NoticeFields } from "../../../notice-fields";
import { decideContent } from "./actions";

// The two decisions on a queued item, each its own form so the reason typed for one is not sent
// with the other.
export function DecisionForms({ type, id }: { type: string; id: number }) {
  const t = useTranslations("moderation.review");
  return (
    <>
      <FormRows
        action={decideContent}
        heading={t("approveHeading")}
        description={t("approveDescription")}
        submit={t("approveSubmit")}
        id="approve"
      >
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="approve" />
        <NoticeFields idPrefix="approve" />
      </FormRows>
      <FormRows
        action={decideContent}
        heading={t("rejectHeading")}
        description={t("rejectDescription")}
        submit={t("rejectSubmit")}
        id="reject"
      >
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="reject" />
        <NoticeFields idPrefix="reject" />
      </FormRows>
    </>
  );
}
