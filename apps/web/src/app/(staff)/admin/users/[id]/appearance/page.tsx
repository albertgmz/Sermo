import { catalogImagesList, paletteColorsList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { Section } from "@/components/staff/rows";
import { read } from "@/lib/sermo/client";
import { getMember, isReadOnly, memberIdOf } from "../../data";
import { Notice } from "../../notice";
import { TabPage } from "../../tab-page";
import { AppearanceForm } from "./appearance-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.appearance");
  return { title: t("metaTitle") };
}

const entries = (items: { id: number; name: string; isActive: boolean }[]) =>
  items.filter((item) => item.isActive).map(({ id, name }) => ({ id, name }));

async function Appearance({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/users/[id]/appearance">["params"];
  searchParams: PageProps<"/admin/users/[id]/appearance">["searchParams"];
}) {
  const userId = await memberIdOf(params);
  const [t, member, frames, covers, accents, nameColours] = await Promise.all([
    getTranslations("adminUsers.appearance"),
    getMember(userId),
    read(catalogImagesList, { kind: "frame" }),
    read(catalogImagesList, { kind: "profile_cover" }),
    read(paletteColorsList, { kind: "accent" }),
    read(paletteColorsList, { kind: "name" }),
  ]);
  return (
    <>
      <Notice searchParams={searchParams} shown={["saved"]} />
      <Section heading={t("now")}>
        <div className="flex items-center gap-3 p-4">
          <UserAvatar user={member.card} size="xl" link={false} />
          <div className="min-w-0">
            <UserLink
              user={member.card}
              className="inline-flex min-h-10 items-center text-sm font-semibold"
            />
            <p className="text-xs text-muted-foreground">{member.card.title}</p>
          </div>
        </div>
      </Section>
      <AppearanceForm
        userId={userId}
        readOnly={isReadOnly(member)}
        catalogs={{
          frames: entries(frames.items),
          covers: entries(covers.items),
          accents: entries(accents.items),
          nameColours: entries(nameColours.items),
        }}
      />
    </>
  );
}

export default function MemberAppearancePage({
  params,
  searchParams,
}: PageProps<"/admin/users/[id]/appearance">) {
  const t = useTranslations("adminUsers.appearance");
  return (
    <TabPage label={t("loading")} rows={5}>
      <Appearance params={params} searchParams={searchParams} />
    </TabPage>
  );
}
