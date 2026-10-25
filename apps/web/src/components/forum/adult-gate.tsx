"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
} from "react";
import {
  type AdultConfirmState,
  confirmAdult,
} from "@/components/forum/adult-actions";
import { FormError } from "@/components/forum/form-error";
import { PageLayout } from "@/components/layout/page-layout";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdultReason } from "@/lib/sermo/errors";
import { cn } from "@/lib/utils";

// The +18 page and its warning window, drawn by the error screen in place of content the backend
// refused as +18 (it sent none of it). A guest gets the page with the ways in (log in, create an
// account); a member gets the page under the warning window, which asks them to confirm they are
// 18 or older (`acceptance`), first asks for their date of birth when none is stored
// (`birthDate`), or tells a minor, politely, that it is not for them (`minor`). Leaving the window
// (its Back button, Escape) goes back to the page the member came from: closing it would leave
// them on a page with nothing to see. A confirmation reads the content again (`retry`).

// The figure in a disc: the mark of the +18 page and of the window.
function AdultMark({ className }: { className?: string }) {
  const t = useTranslations("forum.adultGate");
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-14 shrink-0 items-center justify-center rounded-full border-2 border-destructive/70 text-lg font-bold text-destructive tabular-nums",
        className,
      )}
    >
      {t("mark")}
    </span>
  );
}

// Where leaving the window goes: back, when the tab has a page to go back to; else, for a +18
// address opened in a tab of its own, the home page.
export function leaveGate(
  router: { back: () => void; replace: (href: string) => void },
  depth: number,
) {
  if (depth > 1) router.back();
  else router.replace("/");
}

// The window says it is closing (Escape, its Back button): the member leaves the page.
export const onGateChange = (leave: () => void) => (open: boolean) => {
  if (!open) leave();
};

// The page under the window, and the whole of it for a guest.
export function AdultPage({ guest }: { guest: boolean }) {
  const t = useTranslations("forum.adultGate");
  const path = usePathname();
  return (
    <section
      aria-labelledby="adult-page-title"
      className="mx-auto flex w-full max-w-md flex-col items-center rounded-xl border bg-card px-5 py-10 text-center sm:px-8"
    >
      <AdultMark />
      <h1
        id="adult-page-title"
        className="mt-4 text-xl font-semibold tracking-tight text-balance"
      >
        {t("title")}
      </h1>
      <p className="mt-2 max-w-sm text-sm text-pretty text-muted-foreground">
        {t(guest ? "pageGuest" : "pageMember")}
      </p>
      {guest && (
        <div className="mt-6 flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <Link
            href={`/login?next=${encodeURIComponent(path)}`}
            className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
          >
            {t("login")}
          </Link>
          <Link href="/register" className={cn(buttonVariants(), "h-10 px-4")}>
            {t("register")}
          </Link>
        </div>
      )}
    </section>
  );
}

// What the window holds: the title, what the content is, and the one thing asked of the member.
// A date of birth that turns out to be a minor's turns the window into the refusal.
export function AdultWarningBody({
  reason,
  onConfirmed,
}: {
  reason: Exclude<AdultReason, "guest">;
  onConfirmed: () => void;
}) {
  const t = useTranslations("forum.adultGate");
  const id = useId();
  const [state, dispatch, pending] = useActionState<
    AdultConfirmState,
    FormData
  >(confirmAdult, {});
  // Once per answer: a page that is read again draws the window anew only if it is still refused.
  const confirmed = useRef<AdultConfirmState | null>(null);
  useEffect(() => {
    if (!state.done || confirmed.current === state) return;
    confirmed.current = state;
    onConfirmed();
  }, [state, onConfirmed]);
  const minor = reason === "minor" || state.minor === true;
  const back = (
    <DialogClose
      render={<Button type="button" variant="outline" className="h-10 px-4" />}
    >
      {t("back")}
    </DialogClose>
  );
  return (
    <>
      <DialogHeader className="items-center text-center sm:items-start sm:text-left">
        <AdultMark className="size-12 text-base" />
        <DialogTitle className="text-lg leading-snug font-semibold text-balance">
          {t("title")}
        </DialogTitle>
        <DialogDescription className="text-pretty">
          {minor ? t("minor") : t("warning")}
        </DialogDescription>
      </DialogHeader>
      {minor ? (
        <DialogFooter>{back}</DialogFooter>
      ) : (
        // Submitted by hand, so a refused date stays in its field.
        <form
          className="grid min-w-0 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => dispatch(data));
          }}
        >
          {/* Centred under the centred title on a phone, as the title is; the field stays a field. */}
          <p className="text-center text-sm text-pretty sm:text-left">
            {t(reason === "birthDate" ? "birthDateAsk" : "confirmQuestion")}
          </p>
          {reason === "birthDate" && (
            <div className="space-y-2">
              <Label htmlFor={id}>{t("birthDateLabel")}</Label>
              <Input
                id={id}
                name="birthDate"
                type="date"
                required
                min="1900-01-01"
                max={new Date().toISOString().slice(0, 10)}
                autoComplete="bday"
              />
            </div>
          )}
          {state.error && <FormError>{state.error}</FormError>}
          <DialogFooter>
            {back}
            <Button type="submit" disabled={pending} className="h-10 px-4">
              {t(reason === "birthDate" ? "confirmWithDate" : "confirm")}
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  );
}

// The page, and for a member the warning window over it: modal (the focus stays in it, the page
// under it is out of reach), labelled by its title, never closed by a press outside it.
export function AdultGate({
  reason,
  retry,
}: {
  reason: AdultReason;
  retry: () => void;
}) {
  const router = useRouter();
  const popup = useRef<HTMLDivElement>(null);
  const leave = () => leaveGate(router, window.history.length);
  return (
    <PageLayout className="md:py-16">
      <AdultPage guest={reason === "guest"} />
      {reason !== "guest" && (
        <Dialog
          open
          modal
          disablePointerDismissal
          onOpenChange={onGateChange(leave)}
        >
          <DialogContent
            ref={popup}
            showCloseButton={false}
            className="sm:max-w-md"
            // The date field when the window asks for it; else the window itself, which reads out its
            // title and text first and leaves no button looking chosen before the member chose.
            initialFocus={() =>
              popup.current?.querySelector<HTMLElement>('[name="birthDate"]') ??
              popup.current
            }
          >
            <AdultWarningBody reason={reason} onConfirmed={retry} />
          </DialogContent>
        </Dialog>
      )}
    </PageLayout>
  );
}
