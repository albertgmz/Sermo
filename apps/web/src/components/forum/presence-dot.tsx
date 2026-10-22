import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// The online mark on an avatar, as fcuba's forum statistics drew it: a small drop at the avatar's
// top left, pointing at it, green while the member is online and red otherwise. The avatar's frame
// is `relative`. Only "online" is read out; an offline mark is decoration.
export function PresenceDot({
  online,
  className,
}: {
  online: boolean;
  className?: string;
}) {
  const t = useTranslations("forum.presenceDot");
  return (
    <span
      aria-hidden={online ? undefined : true}
      className={cn(
        "pointer-events-none absolute -top-0.5 -left-0.5 z-10 size-2.75 rounded-[50%_50%_0_50%] border border-card",
        online ? "bg-success" : "bg-destructive",
        className,
      )}
    >
      {online && <span className="sr-only">{t("online")}</span>}
    </span>
  );
}
