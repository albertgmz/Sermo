import { Check } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AppearanceForm } from "@/app/(main)/account/appearance-form";
import { Art } from "@/components/forum/art";
import { MemberCard } from "@/components/forum/member-card";
import { UserAvatar } from "@/components/forum/user-avatar";
import { userNameProps } from "@/components/forum/user-name";
import {
  ACCENTS,
  COVERS,
  coverSrc,
  DEFAULT_ACCENT,
  NAME_COLORS,
  type NameColorKey,
} from "@/lib/appearance";
import type { Unlocks, UserView } from "@/lib/db";
import { frameView, nameColorHex, staffNameHex } from "@/lib/legacy-views";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const choiceClass =
  "relative flex min-h-10 w-full items-center justify-center overflow-hidden rounded-md border text-sm font-medium transition-colors hover:border-input aria-pressed:border-primary aria-pressed:bg-primary/10";

const shopLinkClass =
  "inline-flex min-h-10 items-center text-sm font-medium text-primary underline-offset-4 hover:underline";

function Selected() {
  return (
    <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
      <Check aria-hidden="true" className="size-3" />
    </span>
  );
}

export function AppearancePanel({
  user,
  unlocks,
  frameNames,
  saved,
}: {
  user: UserView;
  unlocks: Unlocks;
  frameNames: Record<string, string>;
  saved: string | undefined;
}) {
  const t = useTranslations("account.appearance");
  const labels = useTranslations("lib.appearance");
  const { appearance } = user;
  const accent = appearance.accent ?? DEFAULT_ACCENT;
  const frames = [...new Set(unlocks.frames)];
  const colors = [...new Set(unlocks.nameColors)];
  const canSetCover = can(user, "profileCover");
  const colorLabel = (color: string | null) =>
    color && color in NAME_COLORS
      ? labels(`nameColors.${color as NameColorKey}`)
      : t("nameColorDefault");

  return (
    <section id="appearance" className="scroll-mt-4 rounded-lg border bg-card">
      <div className="border-b p-4">
        <h1 className="text-xl font-bold tracking-tight">{t("heading")}</h1>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <div className="grid gap-6 p-4 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
        <div className="min-w-0 xl:col-start-2 xl:row-start-1">
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t("previewHeading")}
          </p>
          <MemberCard user={user} />
          <p className="mt-2 text-xs text-pretty text-muted-foreground">
            {t("previewDescription")}
          </p>
        </div>

        <div className="min-w-0 space-y-6 xl:col-start-1 xl:row-start-1">
          <AppearanceForm
            field="accent"
            title={t("accentHeading")}
            description={t("accentDescription")}
            saved={saved === "accent"}
          >
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {ACCENTS.map(({ key }) => (
                <li key={key} data-accent={key}>
                  <button
                    type="submit"
                    name="value"
                    value={key}
                    aria-pressed={key === accent}
                    className={cn(choiceClass, "flex-col gap-1.5 py-2.5")}
                  >
                    <span
                      aria-hidden="true"
                      className="size-6 rounded-full bg-primary"
                    />
                    {labels(`accents.${key}`)}
                    {key === accent && <Selected />}
                  </button>
                </li>
              ))}
            </ul>
          </AppearanceForm>

          <AppearanceForm
            field="frame"
            title={t("frameHeading")}
            description={t("frameDescription")}
            saved={saved === "frame"}
          >
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
              {[null, ...frames].map((frame) => (
                <li key={frame ?? "none"}>
                  <button
                    type="submit"
                    name="value"
                    value={frame ?? ""}
                    aria-pressed={frame === appearance.frame}
                    aria-label={
                      frame
                        ? t("aria.frame", {
                            name: frameNames[frame] ?? t("frameFallback"),
                          })
                        : t("aria.noFrame")
                    }
                    className={cn(choiceClass, "h-28 flex-col gap-1")}
                  >
                    <UserAvatar
                      user={{ ...user.member, frame: frameView(frame) }}
                      size="xl"
                      link={false}
                    />
                    {!frame && (
                      <span className="text-xs text-muted-foreground">
                        {t("frameEmpty")}
                      </span>
                    )}
                    {frame === appearance.frame && <Selected />}
                  </button>
                </li>
              ))}
            </ul>
            <Link href="/credits?category=frame" className={shopLinkClass}>
              {t("framesLink")}
            </Link>
          </AppearanceForm>

          <AppearanceForm
            field="nameColor"
            title={t("nameColorHeading")}
            description={t("nameColorDescription")}
            saved={saved === "nameColor"}
          >
            <ul className="flex flex-wrap gap-2">
              {[null, ...colors].map((color) => {
                const name = userNameProps({
                  nameColor: color
                    ? nameColorHex(color)
                    : staffNameHex(user.role),
                });
                return (
                  <li key={color ?? "default"} className="max-w-full">
                    <button
                      type="submit"
                      name="value"
                      value={color ?? ""}
                      aria-pressed={color === appearance.nameColor}
                      aria-label={t("aria.nameColor", {
                        name: colorLabel(color),
                      })}
                      className={cn(choiceClass, "gap-2 px-3 pr-7")}
                    >
                      <span
                        className={cn("truncate font-semibold", name.className)}
                        style={name.style}
                      >
                        {user.username}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {colorLabel(color)}
                      </span>
                      {color === appearance.nameColor && <Selected />}
                    </button>
                  </li>
                );
              })}
            </ul>
            <Link href="/credits?category=color" className={shopLinkClass}>
              {t("nameColorsLink")}
            </Link>
          </AppearanceForm>

          <AppearanceForm
            field="cover"
            title={t("coverHeading")}
            description={
              canSetCover ? t("coverDescription") : t("coverLockedDescription")
            }
            saved={saved === "cover"}
          >
            {!canSetCover && (
              <Link
                href="/credits?category=permission#permission-profileCover"
                className={shopLinkClass}
              >
                {t("coverLockedLink")}
              </Link>
            )}
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              <li>
                <button
                  type="submit"
                  name="value"
                  value=""
                  aria-pressed={appearance.cover === null}
                  aria-label={t("aria.noCover")}
                  className={cn(choiceClass, "flex-col")}
                >
                  <span className="aspect-(--aspect-cover) w-full bg-muted" />
                  <span className="flex h-8 items-center text-xs text-muted-foreground">
                    {t("coverEmpty")}
                  </span>
                  {appearance.cover === null && <Selected />}
                </button>
              </li>
              {COVERS.map(({ key }) => (
                <li key={key}>
                  <button
                    type="submit"
                    name="value"
                    value={key}
                    disabled={!canSetCover}
                    aria-pressed={key === appearance.cover}
                    aria-label={t("aria.cover", {
                      name: labels(`covers.${key}`),
                    })}
                    className={cn(
                      choiceClass,
                      "flex-col disabled:pointer-events-none disabled:opacity-40",
                    )}
                  >
                    <Art
                      category="profileCovers"
                      src={coverSrc(key)}
                      className="aspect-(--aspect-cover) w-full bg-[position:75%_30%]"
                    />
                    <span className="flex h-8 items-center text-xs">
                      {labels(`covers.${key}`)}
                    </span>
                    {key === appearance.cover && <Selected />}
                  </button>
                </li>
              ))}
            </ul>
          </AppearanceForm>
        </div>
      </div>
    </section>
  );
}
