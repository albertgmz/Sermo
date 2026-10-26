"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Asks before a block or an unblock, over the page, as XenForo asks before an ignore: what the
// block does (the two members stop seeing each other, their private conversations disappear for
// both) or what an unblock does not bring back. Escape, Cancel and a press outside close it; the
// focus goes back to the button that opened it.
//
// Props
//   open, onOpenChange  Whether it is open, and what hears of it closing.
//   username            The member to block or unblock.
//   blocking            The viewer blocks the member now: the dialog asks to unblock.
//   onConfirm           Runs the change; the dialog closes first.
export function BlockDialog({
  open,
  onOpenChange,
  ...body
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & Omit<React.ComponentProps<typeof BlockDialogBody>, "onClose">) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <BlockDialogBody {...body} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// What the dialog holds: the question, what the change does, then Cancel and the confirming button.
export function BlockDialogBody({
  username,
  blocking,
  onConfirm,
  onClose,
}: {
  username: string;
  blocking: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("forum.memberActions");
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(blocking ? "blockDialog.unblockTitle" : "blockDialog.blockTitle", {
            username,
          })}
        </DialogTitle>
        <DialogDescription>
          {t(blocking ? "blockDialog.unblockBody" : "blockDialog.blockBody", {
            username,
          })}
        </DialogDescription>
        {!blocking && (
          <p className="text-sm text-muted-foreground">
            {t("blockDialog.blockNote", { username })}
          </p>
        )}
      </DialogHeader>
      <DialogFooter>
        <DialogClose
          render={<Button variant="outline" className="h-10 px-4" />}
        >
          {t("blockDialog.cancel")}
        </DialogClose>
        <Button
          type="button"
          variant={blocking ? "default" : "destructive"}
          className="h-10 px-4"
          onClick={() => {
            onClose();
            onConfirm();
          }}
        >
          {t(blocking ? "unblock" : "block")}
        </Button>
      </DialogFooter>
    </>
  );
}
