import { profilesGet } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { Notice } from "@/components/staff/notice";
import { Section } from "@/components/staff/rows";
import { buttonVariants } from "@/components/ui/button";
import { call } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";
import { hrefFor } from "../../../registry";
import { getMember, ifAllowed, isReadOnly, memberIdOf } from "../data";
import { MemberState } from "../member-state";
import { TabPage } from "../tab-page";
import { removePicture } from "./actions";
import { EraseForm } from "./erase-form";
import { IdentityForm } from "./identity-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.identity");
  return { title: t("metaTitle") };
}

const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

async function Details({
  params,
  searchParams,
}: {
  params: PageProps<"/[locale]/admin/users/[id]">["params"];
  searchParams: PageProps<"/[locale]/admin/users/[id]">["searchParams"];
}) {
  const userId = await memberIdOf(params);
  const [t, viewer, member, profile] = await Promise.all([
    getTranslations("adminUsers.identity"),
    getViewer(),
    getMember(userId),
    ifAllowed(() => call(profilesGet, { userId })),
  ]);
  const readOnly = isReadOnly(member);
  const sanctions = hrefFor(viewer, "usersSanctions");
  const sessions = hrefFor(viewer, "usersSessions");
  const pictures = [
    { which: "avatar", set: member.card.avatar !== null },
    { which: "cover", set: profile ? profile.cover !== null : null },
  ] as const;
  return (
    <>
      <Notice
        namespace="adminUsers.notices"
        searchParams={searchParams}
        shown={[
          "identity",
          "resetSent",
          "avatarRemoved",
          "coverRemoved",
          "erased",
        ]}
      />
      <IdentityForm member={member} readOnly={readOnly} />
      <Section heading={t("picturesHeading")}>
        <ul className="divide-y">
          {pictures.map(({ which, set }) => (
            <li
              key={which}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <p className="text-sm">
                <span className="font-medium">{t(`picture.${which}`)}</span>{" "}
                <span className="text-muted-foreground">
                  {set === null
                    ? t("pictureUnknown")
                    : set
                      ? t("pictureSet")
                      : t("pictureNone")}
                </span>
              </p>
              {set !== false && !readOnly && (
                <ConfirmStep
                  action={removePicture}
                  fields={{ id: userId, which }}
                  summary={t("remove")}
                  reason={t("removeReason")}
                  warning={t(`removeWarning.${which}`)}
                />
              )}
            </li>
          ))}
        </ul>
      </Section>
      <Section heading={t("accountHeading")}>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <MemberState state={member.state} />
          {member.erasedAt && (
            <p className="text-sm text-muted-foreground">
              {t("erasedOn", { date: new Date(member.erasedAt) })}
            </p>
          )}
          {sanctions && (
            <Link
              href={sanctions.replace("[id]", String(userId))}
              className={link}
            >
              {t("sanctions")}
            </Link>
          )}
          {sessions && (
            <Link
              href={sessions.replace("[id]", String(userId))}
              className={link}
            >
              {t("signOutEverywhere")}
            </Link>
          )}
        </div>
      </Section>
      {!readOnly && <EraseForm member={member} />}
    </>
  );
}

export default function MemberPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/users/[id]">) {
  const t = useTranslations("adminUsers.identity");
  return (
    <TabPage label={t("loading")} rows={6}>
      <Details params={params} searchParams={searchParams} />
    </TabPage>
  );
}
