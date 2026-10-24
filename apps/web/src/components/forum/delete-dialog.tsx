"use client";

import { useTranslations } from "next-intl";
import { DeleteControl } from "@/components/forum/delete-control";
import { Label } from "@/components/ui/label";

// XenForo's delete dialog, the one for posts, threads, wall posts, comments and conversation
// messages: "Remove from public view" (the soft delete) or "Permanently delete", and a reason. The
// choice is offered only to a viewer who holds the hard-delete permission (`permanent`); without
// it the dialog is the soft delete and its reason. The form posts `hardDelete` ("0" or "1") and
// `reason`; the server action of the content reads them.
//
// Props
//   action          The server action the confirming button submits.
//   permanent       Left out: only the soft delete. "choice": both, the soft delete selected.
//                   "only": the item is already out of public view, so only the permanent delete.
//   warning         What the soft delete does, where it is not the usual line.
//   permanentHint   What the permanent delete erases, where it is not the usual line.
//   label           The button that opens the dialog (when it owns its button).
//   confirm         The confirming button.
//   open            Set where a bar owns the opening button; `onOpenChange` hears of Cancel.
export function DeleteDialog({
  action,
  permanent,
  warning,
  permanentHint,
  label,
  confirm,
  open,
  onOpenChange,
}: {
  action: React.ComponentProps<typeof DeleteControl>["action"];
  permanent?: "choice" | "only";
  warning?: string;
  permanentHint?: string;
  label?: string;
  confirm?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("forum.contentActions");
  const only = permanent === "only";
  const soft = warning ?? t("deleteWarning");
  const hard = permanentHint ?? t("deletePermanentlyHint");
  return (
    <DeleteControl
      open={open}
      onOpenChange={onOpenChange}
      action={action}
      label={label ?? (only ? t("hardDelete") : t("delete"))}
      confirm={confirm ?? (only ? t("hardDeleteConfirm") : t("confirmDelete"))}
      cancel={t("cancel")}
      reasonLabel={t("deleteReason")}
      warning={permanent === undefined ? soft : only ? hard : undefined}
    >
      {only && <input type="hidden" name="hardDelete" value="1" />}
      {permanent === "choice" && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{t("deleteType")}</legend>
          <Choice value="0" label={t("removeFromView")} hint={soft} checked />
          <Choice value="1" label={t("hardDelete")} hint={hard} />
        </fieldset>
      )}
    </DeleteControl>
  );
}

function Choice({
  value,
  label,
  hint,
  checked,
}: {
  value: string;
  label: string;
  hint: string;
  checked?: boolean;
}) {
  return (
    <Label className="min-h-10 items-start py-2 text-sm font-normal">
      <input
        type="radio"
        name="hardDelete"
        value={value}
        defaultChecked={checked}
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <span className="space-y-0.5">
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-pretty text-muted-foreground">
          {hint}
        </span>
      </span>
    </Label>
  );
}
