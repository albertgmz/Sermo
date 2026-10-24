"use client";

import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { submitClass } from "@/components/forum/composer-buttons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// The "Edit" dialog of a thread or a direct message, as XenForo's edit overlay: the button, drawn
// as the lazy one that stood in for it, and the form over the page under the dialog's title.
export function EditDialog({
  title,
  trigger,
  triggerClassName,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  // What the button holds: its icon and its label.
  trigger: React.ReactNode;
  triggerClassName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger className={triggerClassName}>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

// The dialog's buttons: Cancel, which closes it, then the caller's (Save, or Try again).
export function EditDialogFooter({ children }: { children: React.ReactNode }) {
  const t = useTranslations("forum.inPlaceEdit");
  return (
    <DialogFooter>
      <DialogClose render={<Button variant="outline" className="h-10 px-4" />}>
        {t("cancel")}
      </DialogClose>
      {children}
    </DialogFooter>
  );
}

export function EditDialogSave({ pending }: { pending: boolean }) {
  const t = useTranslations("forum.inPlaceEdit");
  return (
    <Button
      type="submit"
      disabled={pending}
      className={cn(submitClass, "h-10")}
    >
      <Save aria-hidden="true" />
      {t("save")}
    </Button>
  );
}

// As XenForo's: the member is put in the form's title, at its end.
export function focusTitleAtEnd(form: HTMLFormElement | null) {
  const title = form?.querySelector<HTMLInputElement>('input[name="title"]');
  title?.focus();
  title?.setSelectionRange(title.value.length, title.value.length);
}
