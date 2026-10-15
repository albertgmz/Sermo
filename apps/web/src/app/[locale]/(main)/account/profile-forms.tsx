import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import {
  clearSignature,
  clearTitle,
  removePicture,
  saveProfile,
} from "@/app/[locale]/(main)/account/actions";
import {
  getRenameUnits,
  getSelf,
  getWorn,
  shopHref,
} from "@/app/[locale]/(main)/account/data";
import {
  Notice,
  noticeOf,
  type SearchParams,
} from "@/app/[locale]/(main)/account/notice";
import { PictureRow } from "@/app/[locale]/(main)/account/picture-row";
import { UsernameForm } from "@/app/[locale]/(main)/account/username-form";
import { Art } from "@/components/forum/art";
import { AutosaveForm } from "@/components/forum/autosave";
import { PendingButton } from "@/components/forum/pending-button";
import { SettingsGroup, SettingsRow } from "@/components/forum/settings";
import { UserAvatar } from "@/components/forum/user-avatar";
import { linkClass, selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { publicUrl } from "@/lib/sermo/config";
import { getViewer } from "@/lib/sermo/session";

const MONTHS = Array.from({ length: 12 }, (_, month) => month + 1);

export async function Pictures() {
  const [t, self, worn, viewer] = await Promise.all([
    getTranslations("account.pictures"),
    getSelf(),
    getWorn(),
    getViewer(),
  ]);
  const { profile } = self;
  const may = viewer.resolvedPermissions;
  return (
    <>
      <PictureRow
        kind="avatar"
        title={t("avatarLabel")}
        description={t("avatarHelp")}
        current={<UserAvatar user={profile.card} size="2xl" link={false} />}
        hasPicture={Boolean(profile.avatar)}
        canUpload={may["profile.uploadAvatar"] !== false}
        remove={removePicture.bind(null, "avatar")}
      />
      <PictureRow
        kind="cover"
        title={t("coverLabel")}
        description={t("coverHelp")}
        current={
          profile.cover ? (
            <Art
              category="profileCovers"
              src={profile.cover.url}
              className="aspect-(--aspect-cover) w-48 rounded-md border"
            />
          ) : (
            <div className="aspect-(--aspect-cover) w-48 rounded-md border bg-muted" />
          )
        }
        hasPicture={Boolean(profile.cover)}
        canUpload={may["profile.uploadCover"] !== false}
        note={worn.coverPresetId === null ? undefined : t("coverGalleryWorn")}
        remove={removePicture.bind(null, "cover")}
      />
    </>
  );
}

export async function Username() {
  const [t, self, viewer] = await Promise.all([
    getTranslations("account.username"),
    getSelf(),
    getViewer(),
  ]);
  const { username } = self.profile;
  const free = viewer.resolvedPermissions["profile.renameFree"] === true;
  // Staff-only renaming and a used-up limit come from the backend's word on this member.
  const { reason, availableAt } = self.usernameChange;
  if (reason) {
    const format = await getFormatter();
    return (
      <SettingsRow
        id="username"
        title={t("label")}
        description={
          reason === "approval"
            ? t("approval")
            : availableAt
              ? t("limit", {
                  date: format.dateTime(new Date(availableAt), {
                    dateStyle: "long",
                  }),
                })
              : t("limitAll")
        }
      >
        <p className="text-sm [overflow-wrap:anywhere]">{username}</p>
      </SettingsRow>
    );
  }
  // Asked only where it decides: a member who renames freely needs no count.
  const units = free ? null : await getRenameUnits();
  if (free || (units ?? 0) > 0) {
    return <UsernameForm username={username} units={units} />;
  }
  return (
    <SettingsRow
      id="username"
      title={t("label")}
      description={t.rich("none", {
        shop: (chunks) => (
          <Link href={shopHref} className={linkClass}>
            {chunks}
          </Link>
        ),
      })}
    >
      <p className="text-sm [overflow-wrap:anywhere]">{username}</p>
    </SettingsRow>
  );
}

export async function About() {
  const [t, locale, self] = await Promise.all([
    getTranslations("account.about"),
    getLocale(),
    getSelf(),
  ]);
  const { profile, birthYear } = self;
  const { birthday } = profile;
  const monthNames = new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  });
  return (
    <>
      <AutosaveForm
        id="about"
        action={saveProfile.bind(null, "about")}
        title={t("aboutLabel")}
        description={t("aboutHelp")}
        htmlFor="profile-about"
      >
        <Textarea
          id="profile-about"
          name="about"
          defaultValue={profile.about}
          className="min-h-24"
        />
      </AutosaveForm>
      <AutosaveForm
        action={saveProfile.bind(null, "location")}
        title={t("locationLabel")}
        htmlFor="profile-location"
      >
        <Input
          id="profile-location"
          name="location"
          defaultValue={profile.location}
          autoComplete="address-level2"
        />
      </AutosaveForm>
      <AutosaveForm
        action={saveProfile.bind(null, "website")}
        title={t("websiteLabel")}
        description={t("websiteHelp")}
        htmlFor="profile-website"
      >
        <Input
          id="profile-website"
          name="website"
          type="text"
          inputMode="url"
          autoComplete="url"
          defaultValue={profile.website}
        />
      </AutosaveForm>
      <AutosaveForm
        action={saveProfile.bind(null, "birthday")}
        requires={["day", "month"]}
        title={t("birthdayLabel")}
        description={t("birthdayHelp")}
        htmlFor="profile-birthday-day"
      >
        <div className="grid grid-cols-[minmax(0,4.5rem)_minmax(0,1fr)_minmax(0,5.5rem)] gap-2">
          <Input
            id="profile-birthday-day"
            name="day"
            inputMode="numeric"
            placeholder={t("dayPlaceholder")}
            aria-label={t("dayLabel")}
            defaultValue={birthday?.day ?? ""}
          />
          <select
            name="month"
            aria-label={t("monthLabel")}
            defaultValue={birthday?.month ?? ""}
            className={selectClass}
          >
            <option value="">{t("monthPlaceholder")}</option>
            {MONTHS.map((month) => (
              <option key={month} value={month}>
                {monthNames.format(Date.UTC(2000, month - 1, 1))}
              </option>
            ))}
          </select>
          <Input
            name="year"
            inputMode="numeric"
            placeholder={t("yearPlaceholder")}
            aria-label={t("yearLabel")}
            defaultValue={birthYear ?? ""}
          />
        </div>
      </AutosaveForm>
      <AutosaveForm
        action={saveProfile.bind(null, "discord")}
        title={t("discordLabel")}
        htmlFor="profile-discord"
      >
        <Input
          id="profile-discord"
          name="discord"
          defaultValue={profile.socials.discord}
          autoCapitalize="none"
        />
      </AutosaveForm>
      <AutosaveForm
        action={saveProfile.bind(null, "telegram")}
        title={t("telegramLabel")}
        htmlFor="profile-telegram"
      >
        <Input
          id="profile-telegram"
          name="telegram"
          defaultValue={profile.socials.telegram}
          autoCapitalize="none"
        />
      </AutosaveForm>
      <AutosaveForm
        action={saveProfile.bind(null, "x")}
        title={t("xLabel")}
        description={t("handlesHelp")}
        htmlFor="profile-x"
      >
        <Input
          id="profile-x"
          name="x"
          defaultValue={profile.socials.x}
          autoCapitalize="none"
        />
      </AutosaveForm>
    </>
  );
}

// A title or signature the member holds but may no longer set: shown, with a button to remove it
// (the one thing they can still do). A redirect brings the page back with a notice.
function Held({
  id,
  title,
  value,
  notShown,
  locked,
  remove,
  removeLabel,
  multiline = false,
}: {
  id: string;
  title: string;
  value: string | null;
  notShown: string;
  locked: React.ReactNode;
  remove: () => Promise<void>;
  removeLabel: string;
  multiline?: boolean;
}) {
  return (
    <SettingsRow id={id} title={title} description={value ? notShown : locked}>
      {value && (
        <>
          <p
            className={`text-sm [overflow-wrap:anywhere]${multiline ? " whitespace-pre-wrap" : ""}`}
          >
            {value}
          </p>
          <form action={remove}>
            <PendingButton variant="outline" className="min-h-10 px-4">
              {removeLabel}
            </PendingButton>
          </form>
        </>
      )}
    </SettingsRow>
  );
}

export async function TitleSection() {
  const [t, self] = await Promise.all([
    getTranslations("account.title"),
    getSelf(),
  ]);
  const { may, limits, customTitle, signatureSource } = self;
  const shop = (chunks: React.ReactNode) => (
    <Link href={shopHref} className={linkClass}>
      {chunks}
    </Link>
  );
  return (
    <>
      {may.setCustomTitle ? (
        <AutosaveForm
          id="title"
          action={saveProfile.bind(null, "customTitle")}
          title={t("titleLabel")}
          description={t("titleHelp", { count: limits.customTitleMaxLength })}
          htmlFor="profile-title"
        >
          <Input
            id="profile-title"
            name="customTitle"
            defaultValue={customTitle ?? ""}
          />
        </AutosaveForm>
      ) : (
        <Held
          id="title"
          title={t("titleLabel")}
          value={customTitle}
          notShown={t("notShown")}
          locked={t.rich("titleLocked", { shop })}
          remove={clearTitle}
          removeLabel={t("remove")}
        />
      )}
      {may.setSignature ? (
        <AutosaveForm
          id="signature"
          action={saveProfile.bind(null, "signature")}
          title={t("signatureLabel")}
          description={t("signatureHelp", {
            count: limits.signatureMaxLength,
            lines: limits.signatureMaxLines,
          })}
          htmlFor="profile-signature"
        >
          <Textarea
            id="profile-signature"
            name="signature"
            defaultValue={signatureSource ?? ""}
            className="min-h-24"
          />
        </AutosaveForm>
      ) : (
        <Held
          id="signature"
          title={t("signatureLabel")}
          value={signatureSource}
          notShown={t("notShown")}
          locked={t.rich("signatureLocked", { shop })}
          remove={clearSignature}
          removeLabel={t("remove")}
          multiline
        />
      )}
    </>
  );
}

async function Referral() {
  const [t, self] = await Promise.all([
    getTranslations("account.referral"),
    getSelf(),
  ]);
  const link = new URL(
    `/register?ref=${self.profile.id}`,
    publicUrl(),
  ).toString();
  return (
    <SettingsRow
      id="referral"
      title={t("heading")}
      description={t("description")}
      htmlFor="referral-link"
    >
      <Input
        id="referral-link"
        readOnly
        value={link}
        aria-describedby="referral-count"
      />
      <p id="referral-count" className="text-xs text-muted-foreground">
        {t("count", { count: self.profile.referralCount })}
      </p>
    </SettingsRow>
  );
}

// The first group of the settings screen: every row saves by itself.
export async function ProfileGroup({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [t, notice] = await Promise.all([
    getTranslations("account.profile"),
    // What a redirected button leaves behind: the username changed, a held title or signature
    // removed, or the backend's refusal of that removal.
    noticeOf(
      searchParams,
      ["username", "titleRemoved", "signatureRemoved"],
      ["title"],
    ),
  ]);
  return (
    <SettingsGroup
      id="profile"
      heading={t("profileGroup")}
      description={t("profileDescription")}
    >
      <Notice notice={notice} />
      <Pictures />
      <Username />
      <About />
      <TitleSection />
      <Referral />
    </SettingsGroup>
  );
}
