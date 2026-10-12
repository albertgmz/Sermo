import {
  AtSign,
  Award,
  Image,
  type LucideIcon,
  Signature,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getRenameUnits, getSelf, shopHref } from "@/app/(main)/account/data";
import { linkClass } from "@/app/(main)/account/section";
import { Badge } from "@/components/ui/badge";
import { getViewer } from "@/lib/sermo/session";

type Perk = {
  key: "signature" | "customTitle" | "coverPreset" | "awardSlots" | "username";
  icon: LucideIcon;
  has: boolean;
  detail?: string;
  use?: string;
};

export async function PerksList() {
  const [t, viewer, self] = await Promise.all([
    getTranslations("account.perks"),
    getViewer(),
    getSelf(),
  ]);
  const can = viewer.resolvedPermissions;
  const slots =
    typeof can["profile.awardSlots"] === "number"
      ? can["profile.awardSlots"]
      : 0;
  const free = can["profile.renameFree"] === true;
  const units = free ? 0 : await getRenameUnits();
  const perks: Perk[] = [
    {
      key: "signature",
      icon: Signature,
      has: self.may.setSignature,
      use: "/account#title",
    },
    {
      key: "customTitle",
      icon: Tag,
      has: self.may.setCustomTitle,
      use: "/account#title",
    },
    {
      key: "coverPreset",
      icon: Image,
      has: Boolean(can["profile.coverPreset"]),
      use: "/account/appearance#cover",
    },
    {
      key: "awardSlots",
      icon: Award,
      has: slots !== 0,
      detail:
        slots === -1
          ? t("slotsAll")
          : slots > 0
            ? t("slots", { count: slots })
            : undefined,
    },
    {
      key: "username",
      icon: AtSign,
      has: free || units > 0,
      detail: free
        ? t("renameFree")
        : units > 0
          ? t("renameUnits", { count: units })
          : undefined,
      use: "/account#username",
    },
  ];
  return (
    <section id="perks" className="scroll-mt-4 rounded-lg border bg-card">
      <div className="border-b p-4">
        <h1 className="text-xl font-bold tracking-tight">{t("heading")}</h1>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <ul className="divide-y">
        {perks.map(({ key, icon: Icon, has, detail, use }) => (
          <li
            key={key}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                {t(`items.${key}.label`)}
                {has ? (
                  <Badge variant="success">{t("granted")}</Badge>
                ) : (
                  <Badge variant="secondary">{t("locked")}</Badge>
                )}
              </p>
              <p className="text-xs text-pretty text-muted-foreground">
                {t(`items.${key}.description`)}
                {detail && ` ${detail}`}
              </p>
            </div>
            <p className="flex basis-full flex-wrap items-center gap-x-3 text-xs sm:basis-auto sm:justify-end">
              {has && use ? (
                <Link href={use} className={linkClass}>
                  {t("use")}
                  <span className="sr-only"> {t(`items.${key}.label`)}</span>
                </Link>
              ) : has ? null : (
                <Link href={shopHref} className={linkClass}>
                  {t("shop")}
                  <span className="sr-only"> {t(`items.${key}.label`)}</span>
                </Link>
              )}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
