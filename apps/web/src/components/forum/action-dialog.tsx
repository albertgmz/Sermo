"use client";

import { useTranslations } from "next-intl";
import { useId, useRef } from "react";
import type { ActionFormState } from "@/components/forum/action-form";
import { FormError } from "@/components/forum/form-error";
import { useKeptForm } from "@/components/forum/use-kept-form";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Action = (
  previous: ActionFormState,
  formData: FormData,
) => Promise<ActionFormState>;

// XenForo's overlay for what is done to an item after asking (delete, report): the app's modal
// dialog over the page. The focus goes to the reason when it opens; Escape, Cancel, its close button
// and a press outside it close it, and the focus goes back to the button that opened it. Being
// modal, it is the only one open.
//
// Props
//   open, onOpenChange  Whether it is open, and what hears of it opening or closing.
//   trigger             The opening button's words, where the dialog owns its button; left out
//                       where a bar owns it (`ContentActions`).
//   finalFocus          Where the focus goes once it closes, where that is not the trigger.
//   children            What it holds (`ActionDialogBody`).
export function ActionDialog({
  open,
  onOpenChange,
  trigger,
  finalFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: string;
  finalFocus?: () => HTMLElement | null;
  children: React.ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <DialogTrigger
          render={<Button variant="destructive" className="h-10 px-3" />}
        >
          {trigger}
        </DialogTrigger>
      )}
      <DialogContent
        ref={popup}
        className="sm:max-w-md"
        initialFocus={() =>
          popup.current?.querySelector<HTMLElement>('[name="reason"]') ?? true
        }
        finalFocus={finalFocus && (() => finalFocus() ?? true)}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

// The title, the action's own fields (`children`), the reason, what the backend refused, then
// Cancel and the confirming button. `onDone` hears of an answer that is not a refusal.
export function ActionDialogBody({
  title,
  action,
  submit,
  reason,
  variant = "default",
  onDone,
  children,
}: {
  title: string;
  action: Action;
  submit: string;
  reason: { label: string; required?: boolean };
  variant?: "default" | "destructive";
  onDone?: () => void;
  children?: React.ReactNode;
}) {
  const t = useTranslations("forum.contentActions");
  const id = useId();
  const { state, pending, onSubmit } = useKeptForm(async (previous, data) => {
    const answer = await action(previous, data);
    if (!answer.error) onDone?.();
    return answer;
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      {/* `min-w-0`: an item of the dialog's grid, it keeps to a phone's width. */}
      <form onSubmit={onSubmit} className="grid min-w-0 gap-4">
        {children}
        <div className="space-y-1.5">
          <Label htmlFor={id}>{reason.label}</Label>
          <Input
            id={id}
            name="reason"
            required={reason.required}
            autoComplete="off"
          />
        </div>
        {state.error && <FormError>{state.error}</FormError>}
        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" className="h-10 px-4" />}
          >
            {t("cancel")}
          </DialogClose>
          <Button
            type="submit"
            variant={variant}
            disabled={pending}
            className="h-10 px-4"
          >
            {submit}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
