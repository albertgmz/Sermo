"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import {
  ActionDialog,
  ActionDialogBody,
} from "@/components/forum/action-dialog";
import { announce } from "@/components/forum/notice-store";
import { PageNotice } from "@/components/forum/page-notice";

type Action = React.ComponentProps<typeof ActionDialogBody>["action"];

// The report dialog, the same wherever something can be reported: posts, messages, wall posts and
// comments, over the page as XenForo's (`ActionDialog`). The bar that opens it owns its button
// (`open`, `onOpenChange`, `finalFocus`). Once the report is filed it closes, and a notice floating
// under the header thanks the member, as XenForo's flash message does.
export function ReportDialog({
  action,
  open,
  onOpenChange,
  finalFocus,
}: {
  action: Action;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus?: () => HTMLElement | null;
}) {
  const t = useTranslations("forum.contentActions");
  // Each dialog says its own notice, so only the one that filed a report draws it.
  const notice = `reported-${useId()}`;
  return (
    <>
      <ActionDialog
        open={open}
        onOpenChange={onOpenChange}
        finalFocus={finalFocus}
      >
        <ReportDialogBody
          action={action}
          onDone={() => {
            onOpenChange(false);
            announce(notice);
          }}
        />
      </ActionDialog>
      <PageNotice texts={{ [notice]: t("reported") }} />
    </>
  );
}

// What the report dialog holds: the reason, which a report needs.
export function ReportDialogBody({
  action,
  onDone,
}: {
  action: Action;
  onDone: () => void;
}) {
  const t = useTranslations("forum.contentActions");
  return (
    <ActionDialogBody
      title={t("reportTitle")}
      action={action}
      submit={t("reportSubmit")}
      reason={{ label: t("reportReason"), required: true }}
      onDone={onDone}
    />
  );
}
