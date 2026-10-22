import { Check } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { saveAppearance } from "@/app/[locale]/(main)/account/actions";
import { getSelf, getWorn, shopHref } from "@/app/[locale]/(main)/account/data";
import { Art } from "@/components/forum/art";
import { ChoiceForm } from "@/components/forum/autosave";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { NameWithIcon } from "@/components/forum/name-icon";
import { SettingsGroup, SettingsRow } from "@/components/forum/settings";
import { UserAvatar } from "@/components/forum/user-avatar";
import { userNameProps } from "@/components/forum/user-name";
import { ThemeControl } from "@/components/layout/theme-control";
import { isHexColor } from "@/lib/css-color";
import { paletteName } from "@/lib/palette-name";
import { authorsFor } from "@/lib/sermo/members";
import { cn } from "@/lib/utils";

const choiceClass =
  "relative flex min-h-10 w-full items-center justify-center overflow-hidden rounded-md border text-sm font-medium transition-colors hover:border-input aria-pressed:border-primary aria-pressed:bg-primary/10";

const linkClass =
  "inline-flex min-h-10 items-center text-sm font-medium text-primary-ink underline-offset-4 hover:underline";

function Selected() {
  return (
    <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
      <Check aria-hidden="true" className="size-3" />
    </span>
  );
}

// The second group of the settings screen: a preview of how the member looks, the theme of this
// browser, and the choices the member has unlocked. Every choice saves as it is pressed.
export async function AppearanceGroup() {
  const [t, names, { profile }, worn] = await Promise.all([
    getTranslations("account.appearance"),
    getTranslations("lib.appearance"),
    getSelf(),
    getWorn(),
  ]);
  const author = (await authorsFor([profile]))(profile.id);
  const { member } = author;
  const name = userNameProps(member);
  const { available } = worn;

  return (
    <SettingsGroup
      id="appearance"
      heading={t("heading")}
      description={t("description")}
    >
      <SettingsRow
        title={t("previewHeading")}
        description={t("previewDescription")}
      >
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
      </SettingsRow>

      <SettingsRow
        id="theme"
        title={t("themeHeading")}
        description={t("themeDescription")}
      >
        <ThemeControl />
      </SettingsRow>

      <ChoiceForm
        id="accent"
        action={saveAppearance.bind(null, "accent")}
        title={t("accentHeading")}
        description={t("accentDescription")}
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
                  {accent
                    ? paletteName(names, "accents", accent.name)
                    : t("accentDefault")}
                </span>
                {(accent?.id ?? null) === worn.accentId && <Selected />}
              </button>
            </li>
          ))}
        </ul>
      </ChoiceForm>

      <ChoiceForm
        id="frame"
        action={saveAppearance.bind(null, "frame")}
        title={t("frameHeading")}
        description={t("frameDescription")}
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
      </ChoiceForm>

      <ChoiceForm
        id="nameColor"
        action={saveAppearance.bind(null, "nameColor")}
        title={t("nameColorHeading")}
        description={t("nameColorDescription")}
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
                    name: color
                      ? paletteName(names, "nameColors", color.name)
                      : t("none"),
                  })}
                  className={cn(choiceClass, "gap-2 px-3 pr-7")}
                >
                  <span
                    className={cn("truncate font-semibold", shown.className)}
                    style={shown.style}
                  >
                    {member.username}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {color
                      ? paletteName(names, "nameColors", color.name)
                      : t("none")}
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
      </ChoiceForm>

      <ChoiceForm
        id="nameIcon"
        action={saveAppearance.bind(null, "nameIcon")}
        title={t("nameIconHeading")}
        description={t("nameIconDescription")}
      >
        <ul className="flex flex-wrap gap-2">
          {[null, ...available.nameIcons].map((held) => (
            <li key={held?.itemId ?? "none"} className="max-w-full">
              <button
                type="submit"
                name="value"
                value={held?.itemId ?? ""}
                aria-pressed={(held?.itemId ?? null) === worn.nameIconItemId}
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
                {(held?.itemId ?? null) === worn.nameIconItemId && <Selected />}
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
      </ChoiceForm>

      <ChoiceForm
        id="cover"
        action={saveAppearance.bind(null, "cover")}
        title={t("coverHeading")}
        description={t("coverDescription")}
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
      </ChoiceForm>
    </SettingsGroup>
  );
}
