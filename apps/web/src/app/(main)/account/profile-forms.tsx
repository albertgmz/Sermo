import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/app/(main)/account/action-form";
import {
  clearBirthday,
  clearSignature,
  clearTitle,
  saveAbout,
  saveTitleAndSignature,
} from "@/app/(main)/account/actions";
import { getRenameUnits, getSelf, shopHref } from "@/app/(main)/account/data";
import {
  Notice,
  noticeOf,
  type SearchParams,
} from "@/app/(main)/account/notice";
import {
  Help,
  linkClass,
  Row,
  Section,
  selectClass,
} from "@/app/(main)/account/section";
import { UsernameForm } from "@/app/(main)/account/username-form";
import { PendingButton } from "@/components/forum/pending-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { publicUrl } from "@/lib/sermo/config";
import { getViewer } from "@/lib/sermo/session";

const MONTHS = Array.from({ length: 12 }, (_, month) => month + 1);

export async function UsernameSection({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [t, self, viewer, notice] = await Promise.all([
    getTranslations("account.username"),
    getSelf(),
    getViewer(),
    noticeOf(searchParams, ["username"]),
  ]);
  const { username } = self.profile;
  const free = viewer.resolvedPermissions["profile.renameFree"] === true;
  // Asked only where it decides: a member who renames freely needs no count.
  const units = free ? null : await getRenameUnits();
  return (
    <Section
      id="username"
      heading={t("heading")}
      description={t("description")}
    >
      <Notice notice={notice} />
      {free || (units ?? 0) > 0 ? (
        <UsernameForm username={username} units={units} />
      ) : (
        <Row label={t("label")}>
          <p className="text-sm [overflow-wrap:anywhere]">{username}</p>
          <Help>
            {t.rich("none", {
              shop: (chunks) => (
                <Link href={shopHref} className={linkClass}>
                  {chunks}
                </Link>
              ),
            })}
          </Help>
        </Row>
      )}
    </Section>
  );
}

export async function AboutSection({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [t, self, notice] = await Promise.all([
    getTranslations("account.about"),
    getSelf(),
    noticeOf(searchParams, ["about", "birthdayRemoved"], ["about"]),
  ]);
  const { profile, birthYear } = self;
  const { birthday } = profile;
  const monthNames = new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
  });
  return (
    <Section id="about" heading={t("heading")} description={t("description")}>
      <Notice notice={notice} />
      <ActionForm
        key={`${profile.about}|${birthday?.day}|${birthday?.month}|${birthYear}`}
        action={saveAbout}
        submit={t("submit")}
      >
        <Row label={t("aboutLabel")} htmlFor="profile-about">
          <Textarea
            id="profile-about"
            name="about"
            defaultValue={profile.about}
            className="min-h-24"
            aria-describedby="profile-about-help"
          />
          <Help id="profile-about-help">{t("aboutHelp")}</Help>
        </Row>
        <Row label={t("locationLabel")} htmlFor="profile-location">
          <Input
            id="profile-location"
            name="location"
            defaultValue={profile.location}
            autoComplete="address-level2"
          />
        </Row>
        <Row label={t("websiteLabel")} htmlFor="profile-website">
          <Input
            id="profile-website"
            name="website"
            type="text"
            inputMode="url"
            autoComplete="url"
            defaultValue={profile.website}
            aria-describedby="profile-website-help"
          />
          <Help id="profile-website-help">{t("websiteHelp")}</Help>
        </Row>
        <Row label={t("birthdayLabel")} htmlFor="profile-birthday-day">
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
          <Help>{t("birthdayHelp")}</Help>
          <PendingButton
            variant="outline"
            form="clear-birthday"
            disabled={!birthday}
            className="min-h-10 px-4"
          >
            {t("clearBirthday")}
          </PendingButton>
        </Row>
        <Row label={t("discordLabel")} htmlFor="profile-discord">
          <Input
            id="profile-discord"
            name="discord"
            defaultValue={profile.socials.discord}
            autoCapitalize="none"
          />
        </Row>
        <Row label={t("telegramLabel")} htmlFor="profile-telegram">
          <Input
            id="profile-telegram"
            name="telegram"
            defaultValue={profile.socials.telegram}
            autoCapitalize="none"
          />
        </Row>
        <Row label={t("xLabel")} htmlFor="profile-x">
          <Input
            id="profile-x"
            name="x"
            defaultValue={profile.socials.x}
            autoCapitalize="none"
            aria-describedby="profile-x-help"
          />
          <Help id="profile-x-help">{t("handlesHelp")}</Help>
        </Row>
      </ActionForm>
      {/* A form of its own, so that Enter in the fields above saves the profile and nothing else. */}
      <form id="clear-birthday" action={clearBirthday} />
    </Section>
  );
}

export async function TitleSection({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [t, self, notice] = await Promise.all([
    getTranslations("account.title"),
    getSelf(),
    noticeOf(
      searchParams,
      ["title", "titleRemoved", "signatureRemoved"],
      ["title"],
    ),
  ]);
  const { may, limits, customTitle, signatureSource } = self;
  const shop = (chunks: React.ReactNode) => (
    <Link href={shopHref} className={linkClass}>
      {chunks}
    </Link>
  );
  return (
    <Section id="title" heading={t("heading")} description={t("description")}>
      <Notice notice={notice} />
      {(may.setCustomTitle || may.setSignature) && (
        <ActionForm action={saveTitleAndSignature} submit={t("submit")}>
          {may.setCustomTitle && (
            <Row label={t("titleLabel")} htmlFor="profile-title">
              <Input
                id="profile-title"
                name="customTitle"
                defaultValue={customTitle ?? ""}
                aria-describedby="profile-title-help"
              />
              <Help id="profile-title-help">
                {t("titleHelp", { count: limits.customTitleMaxLength })}
              </Help>
            </Row>
          )}
          {may.setSignature && (
            <Row label={t("signatureLabel")} htmlFor="profile-signature">
              <Textarea
                id="profile-signature"
                name="signature"
                defaultValue={signatureSource ?? ""}
                className="min-h-24"
                aria-describedby="profile-signature-help"
              />
              <Help id="profile-signature-help">
                {t("signatureHelp", {
                  count: limits.signatureMaxLength,
                  lines: limits.signatureMaxLines,
                })}
              </Help>
            </Row>
          )}
        </ActionForm>
      )}
      {!may.setCustomTitle && (
        <div className="border-t first:border-t-0">
          <Row label={t("titleLabel")}>
            {customTitle ? (
              <>
                <p className="text-sm [overflow-wrap:anywhere]">
                  {customTitle}
                </p>
                <Help>{t("notShown")}</Help>
                <form action={clearTitle}>
                  <PendingButton variant="outline" className="min-h-10 px-4">
                    {t("remove")}
                  </PendingButton>
                </form>
              </>
            ) : (
              <Help>{t.rich("titleLocked", { shop })}</Help>
            )}
          </Row>
        </div>
      )}
      {!may.setSignature && (
        <div className="border-t first:border-t-0">
          <Row label={t("signatureLabel")}>
            {signatureSource ? (
              <>
                <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {signatureSource}
                </p>
                <Help>{t("notShown")}</Help>
                <form action={clearSignature}>
                  <PendingButton variant="outline" className="min-h-10 px-4">
                    {t("remove")}
                  </PendingButton>
                </form>
              </>
            ) : (
              <Help>{t.rich("signatureLocked", { shop })}</Help>
            )}
          </Row>
        </div>
      )}
    </Section>
  );
}

export async function ReferralSection() {
  const [t, self] = await Promise.all([
    getTranslations("account.referral"),
    getSelf(),
  ]);
  const link = new URL(
    `/register?ref=${self.profile.id}`,
    publicUrl(),
  ).toString();
  return (
    <Section
      id="referral"
      heading={t("heading")}
      description={t("description")}
    >
      <Row label={t("linkLabel")} htmlFor="referral-link">
        <Input
          id="referral-link"
          readOnly
          value={link}
          aria-describedby="referral-help"
        />
        <Help id="referral-help">
          {t("count", { count: self.profile.referralCount })}
        </Help>
      </Row>
    </Section>
  );
}
