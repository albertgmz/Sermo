import { Check } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppearanceForm } from "@/app/(main)/account/appearance-form";
import { getSelf, getWorn, shopHref } from "@/app/(main)/account/data";
import { Art } from "@/components/forum/art";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { NameWithIcon } from "@/components/forum/name-icon";
import { UserAvatar } from "@/components/forum/user-avatar";
import { userNameProps } from "@/components/forum/user-name";
import { isHexColor } from "@/lib/css-color";
import { authorsFor } from "@/lib/sermo/members";
import { cn } from "@/lib/utils";

const choiceClass =
  "relative flex min-h-10 w-full items-center justify-center overflow-hidden rounded-md border text-sm font-medium transition-colors hover:border-input aria-pressed:border-primary aria-pressed:bg-primary/10";

const linkClass =
  "inline-flex min-h-10 items-center text-sm font-medium text-primary underline-offset-4 hover:underline";

function Selected() {
  return (
    <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
      <Check aria-hidden="true" className="size-3" />
    </span>
  );
}

export async function AppearancePanel({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const [t, { profile }, worn, { saved }] = await Promise.all([
    getTranslations("account.appearance"),
    getSelf(),
    getWorn(),
    searchParams,
  ]);
  const author = (await authorsFor([profile]))(profile.id);
  const { member } = author;
  const name = userNameProps(member);
  const { available } = worn;

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
          <div className="relative isolate flex min-h-28 items-end gap-4 overflow-hidden rounded-lg border bg-card p-4 pt-8">
            <CoverBackdrop cover={author.cover} variant="strip" />
            <UserAvatar user={member} size="xl" link={false} />
            <div className="min-w-0 flex-1">
              <p
                className={cn("truncate text-sm font-semibold", name.className)}
                style={name.style}
              >
                <NameWithIcon user={member} />
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {member.title}
              </p>
            </div>
          </div>
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
              {[null, ...available.accents].map((accent) => (
                <li key={accent?.id ?? "default"}>
                  <button
                    type="submit"
                    name="value"
                    value={accent?.id ?? ""}
                    aria-pressed={(accent?.id ?? null) === worn.accentId}
                    className={cn(choiceClass, "flex-col gap-1.5 py-2.5")}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-6 rounded-full",
                        isHexColor(accent?.color)
                          ? "bg-(--swatch)"
                          : "border bg-muted",
                      )}
                      style={
                        accent && isHexColor(accent.color)
                          ? ({
                              "--swatch": accent.color,
                            } as React.CSSProperties)
                          : undefined
                      }
                    />
                    <span className="max-w-full truncate px-1">
                      {accent?.name ?? t("accentDefault")}
                    </span>
                    {(accent?.id ?? null) === worn.accentId && <Selected />}
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
              {[null, ...available.frames].map((frame) => (
                <li key={frame?.id ?? "none"}>
                  <button
                    type="submit"
                    name="value"
                    value={frame?.id ?? ""}
                    aria-pressed={(frame?.id ?? null) === worn.frameId}
                    aria-label={
                      frame
                        ? t("aria.frame", { name: frame.name })
                        : t("aria.noFrame")
                    }
                    className={cn(choiceClass, "h-28 flex-col gap-1")}
                  >
                    <UserAvatar
                      user={{
                        ...member,
                        frame:
                          frame?.image && frame.placement
                            ? {
                                url: frame.image.url,
                                placement: frame.placement,
                              }
                            : null,
                      }}
                      size="xl"
                      link={false}
                    />
                    <span className="max-w-full truncate px-1 text-xs text-muted-foreground">
                      {frame?.name ?? t("none")}
                    </span>
                    {(frame?.id ?? null) === worn.frameId && <Selected />}
                  </button>
                </li>
              ))}
            </ul>
            {available.frames.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t.rich("framesEmpty", {
                  shop: (chunks) => (
                    <Link href={shopHref} className={linkClass}>
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            )}
          </AppearanceForm>

          <AppearanceForm
            field="nameColor"
            title={t("nameColorHeading")}
            description={t("nameColorDescription")}
            saved={saved === "nameColor"}
          >
            <ul className="flex flex-wrap gap-2">
              {[null, ...available.nameColors].map((color) => {
                const shown = userNameProps({
                  nameColor: color?.color ?? null,
                });
                return (
                  <li key={color?.id ?? "none"} className="max-w-full">
                    <button
                      type="submit"
                      name="value"
                      value={color?.id ?? ""}
                      aria-pressed={(color?.id ?? null) === worn.nameColorId}
                      aria-label={t("aria.nameColor", {
                        name: color?.name ?? t("none"),
                      })}
                      className={cn(choiceClass, "gap-2 px-3 pr-7")}
                    >
                      <span
                        className={cn(
                          "truncate font-semibold",
                          shown.className,
                        )}
                        style={shown.style}
                      >
                        {member.username}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {color?.name ?? t("none")}
                      </span>
                      {(color?.id ?? null) === worn.nameColorId && <Selected />}
                    </button>
                  </li>
                );
              })}
            </ul>
            {available.nameColors.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t.rich("nameColorsEmpty", {
                  shop: (chunks) => (
                    <Link href={shopHref} className={linkClass}>
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            )}
          </AppearanceForm>

          <AppearanceForm
            field="nameIcon"
            title={t("nameIconHeading")}
            description={t("nameIconDescription")}
            saved={saved === "nameIcon"}
          >
            <ul className="flex flex-wrap gap-2">
              {[null, ...available.nameIcons].map((held) => (
                <li key={held?.itemId ?? "none"} className="max-w-full">
                  <button
                    type="submit"
                    name="value"
                    value={held?.itemId ?? ""}
                    aria-pressed={
                      (held?.itemId ?? null) === worn.nameIconItemId
                    }
                    aria-label={
                      held
                        ? t("aria.nameIcon", { name: held.name })
                        : t("aria.noNameIcon")
                    }
                    className={cn(choiceClass, "gap-2 px-3 pr-7")}
                  >
                    <span className="truncate font-semibold">
                      <NameWithIcon
                        user={{
                          username: member.username,
                          nameIcon: held
                            ? { icon: held.icon, position: held.position }
                            : null,
                        }}
                      />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {held?.name ?? t("none")}
                    </span>
                    {(held?.itemId ?? null) === worn.nameIconItemId && (
                      <Selected />
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {available.nameIcons.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t.rich("nameIconsEmpty", {
                  shop: (chunks) => (
                    <Link href={shopHref} className={linkClass}>
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            )}
          </AppearanceForm>

          <AppearanceForm
            field="cover"
            title={t("coverHeading")}
            description={t("coverDescription")}
            saved={saved === "cover"}
          >
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              <li>
                <button
                  type="submit"
                  name="value"
                  value=""
                  aria-pressed={worn.coverPresetId === null}
                  aria-label={t("aria.noCover")}
                  className={cn(choiceClass, "flex-col")}
                >
                  <span className="aspect-(--aspect-cover) w-full bg-muted" />
                  <span className="flex h-8 items-center text-xs text-muted-foreground">
                    {t("none")}
                  </span>
                  {worn.coverPresetId === null && <Selected />}
                </button>
              </li>
              {available.covers.map(
                (cover) =>
                  cover.image && (
                    <li key={cover.id}>
                      <button
                        type="submit"
                        name="value"
                        value={cover.id}
                        aria-pressed={cover.id === worn.coverPresetId}
                        aria-label={t("aria.cover", { name: cover.name })}
                        className={cn(choiceClass, "flex-col")}
                      >
                        <Art
                          category="profileCovers"
                          src={cover.image.url}
                          className="aspect-(--aspect-cover) w-full bg-[position:75%_30%]"
                        />
                        <span className="flex h-8 max-w-full items-center truncate px-1 text-xs">
                          {cover.name}
                        </span>
                        {cover.id === worn.coverPresetId && <Selected />}
                      </button>
                    </li>
                  ),
              )}
            </ul>
            {available.covers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t.rich("coversEmpty", {
                  perks: (chunks) => (
                    <Link href="/account/permissions" className={linkClass}>
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            )}
          </AppearanceForm>
        </div>
      </div>
    </section>
  );
}
