import { Check } from "lucide-react";
import Link from "next/link";
import { AppearanceForm } from "@/app/(main)/account/appearance-form";
import { Art } from "@/components/forum/art";
import { MemberCard } from "@/components/forum/member-card";
import { UserAvatar } from "@/components/forum/user-avatar";
import { userNameClass } from "@/components/forum/user-name";
import {
  ACCENTS,
  COVERS,
  coverSrc,
  DEFAULT_ACCENT,
  nameColor,
} from "@/lib/appearance";
import type { Unlocks, UserView } from "@/lib/db";
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
  const { appearance } = user;
  const accent = appearance.accent ?? DEFAULT_ACCENT;
  const frames = [...new Set(unlocks.frames)];
  const colors = [...new Set(unlocks.nameColors)];
  const canSetCover = can(user, "profileCover");

  return (
    <section id="appearance" className="scroll-mt-4 rounded-lg border bg-card">
      <div className="border-b p-4">
        <h1 className="text-xl font-bold tracking-tight">Appearance</h1>
        <p className="text-xs text-muted-foreground">
          How the forum looks for you, and how you look to everyone else.
        </p>
      </div>
      <div className="grid gap-6 p-4 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
        <div className="min-w-0 xl:col-start-2 xl:row-start-1">
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Preview
          </p>
          <MemberCard user={user} />
          <p className="mt-2 text-xs text-pretty text-muted-foreground">
            Your member card with the choices saved right now.
          </p>
        </div>

        <div className="min-w-0 space-y-6 xl:col-start-1 xl:row-start-1">
          <AppearanceForm
            field="accent"
            title="Accent colour"
            description="Recolours buttons, links and highlights across the whole forum, only for you."
            saved={saved === "accent"}
          >
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {ACCENTS.map(({ key, label }) => (
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
                    {label}
                    {key === accent && <Selected />}
                  </button>
                </li>
              ))}
            </ul>
          </AppearanceForm>

          <AppearanceForm
            field="frame"
            title="Avatar frame"
            description="Shown around your picture everywhere it appears."
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
                        ? `${frameNames[frame] ?? "Frame"} frame`
                        : "No frame"
                    }
                    className={cn(choiceClass, "h-28 flex-col gap-1")}
                  >
                    <UserAvatar
                      user={{ ...user, appearance: { frame } }}
                      size="xl"
                      link={false}
                    />
                    {!frame && (
                      <span className="text-xs text-muted-foreground">
                        None
                      </span>
                    )}
                    {frame === appearance.frame && <Selected />}
                  </button>
                </li>
              ))}
            </ul>
            <Link href="/credits?category=frame" className={shopLinkClass}>
              Get more frames in the shop
            </Link>
          </AppearanceForm>

          <AppearanceForm
            field="nameColor"
            title="Name colour"
            description="The colour of your username in threads, lists and your profile."
            saved={saved === "nameColor"}
          >
            <ul className="flex flex-wrap gap-2">
              {[null, ...colors].map((color) => (
                <li key={color ?? "default"} className="max-w-full">
                  <button
                    type="submit"
                    name="value"
                    value={color ?? ""}
                    aria-pressed={color === appearance.nameColor}
                    aria-label={`${nameColor(color)?.label ?? "Default"} name colour`}
                    className={cn(choiceClass, "gap-2 px-3 pr-7")}
                  >
                    <span
                      className={cn(
                        "truncate font-semibold",
                        color
                          ? nameColor(color)?.text
                          : userNameClass({ role: user.role }),
                      )}
                    >
                      {user.username}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {nameColor(color)?.label ?? "Default"}
                    </span>
                    {color === appearance.nameColor && <Selected />}
                  </button>
                </li>
              ))}
            </ul>
            <Link href="/credits?category=color" className={shopLinkClass}>
              Get more name colours in the shop
            </Link>
          </AppearanceForm>

          <AppearanceForm
            field="cover"
            title="Profile cover"
            description={
              canSetCover
                ? "A photo from the gallery behind your profile, your posts and your member card."
                : "A photo from the gallery behind your profile, your posts and your member card. It needs the profile cover permission, which comes from the shop or a rank."
            }
            saved={saved === "cover"}
          >
            {!canSetCover && (
              <Link
                href="/credits?category=permission#permission-profileCover"
                className={shopLinkClass}
              >
                Locked: get the profile cover permission in the shop
              </Link>
            )}
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              <li>
                <button
                  type="submit"
                  name="value"
                  value=""
                  aria-pressed={appearance.cover === null}
                  aria-label="No cover"
                  className={cn(choiceClass, "flex-col")}
                >
                  <span className="aspect-(--aspect-cover) w-full bg-muted" />
                  <span className="flex h-8 items-center text-xs text-muted-foreground">
                    None
                  </span>
                  {appearance.cover === null && <Selected />}
                </button>
              </li>
              {COVERS.map(({ key, label }) => (
                <li key={key}>
                  <button
                    type="submit"
                    name="value"
                    value={key}
                    disabled={!canSetCover}
                    aria-pressed={key === appearance.cover}
                    aria-label={`${label} cover`}
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
                      {label}
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
