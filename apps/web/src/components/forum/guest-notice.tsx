import { Hourglass } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// What a guest is told once the post is taken: it waits for a moderator, and they will not find it
// on the forum until then (they cannot open it, so there is nothing to go to). `back` is where the
// link leads, to the forum or the thread they were in.
export function GuestNotice({
  back,
}: {
  back: { href: string; label: "backToForum" | "backToThread" };
}) {
  const t = useTranslations("forum.guestPosting");
  return (
    <section
      role="status"
      className="space-y-3 rounded-lg border bg-card p-4 md:p-5"
    >
      <div className="flex items-start gap-3">
        <Hourglass
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
        />
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{t("awaitingTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("awaitingBody")}</p>
        </div>
      </div>
      <Link
        href={back.href}
        className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
      >
        {t(back.label)}
      </Link>
    </section>
  );
}
