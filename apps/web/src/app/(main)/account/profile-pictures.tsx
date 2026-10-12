import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/app/(main)/account/action-form";
import { removePicture, uploadPicture } from "@/app/(main)/account/actions";
import { getSelf, getWorn } from "@/app/(main)/account/data";
import {
  Notice,
  noticeOf,
  type SearchParams,
} from "@/app/(main)/account/notice";
import { Help, Row, Section } from "@/app/(main)/account/section";
import { Art } from "@/components/forum/art";
import { PendingButton } from "@/components/forum/pending-button";
import { UserAvatar } from "@/components/forum/user-avatar";
import { Input } from "@/components/ui/input";

// What the form can state; the backend checks and re-encodes the picture and says why if it
// refuses it.
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export async function PicturesSection({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [t, self, worn, notice] = await Promise.all([
    getTranslations("account.pictures"),
    getSelf(),
    getWorn(),
    noticeOf(searchParams, [
      "avatar",
      "avatarRemoved",
      "cover",
      "coverRemoved",
      "failed",
    ]),
  ]);
  const { profile } = self;
  return (
    <Section
      id="pictures"
      heading={t("heading")}
      description={t("description")}
    >
      <Notice notice={notice} />
      <div id="avatar" className="scroll-mt-4">
        <ActionForm
          action={uploadPicture.bind(null, "avatar")}
          submit={t("upload")}
          extra={
            <PendingButton
              variant="outline"
              className="min-h-10 px-4"
              disabled={!profile.avatar}
              formNoValidate
              formAction={removePicture.bind(null, "avatar")}
            >
              {t("remove")}
            </PendingButton>
          }
        >
          <Row label={t("avatarLabel")} htmlFor="picture-avatar">
            <UserAvatar user={profile.card} size="2xl" link={false} />
            <Input
              id="picture-avatar"
              type="file"
              name="file"
              accept={ACCEPT}
              aria-describedby="picture-avatar-help"
            />
            <Help id="picture-avatar-help">{t("avatarHelp")}</Help>
          </Row>
        </ActionForm>
      </div>
      <div id="cover" className="scroll-mt-4 border-t">
        <ActionForm
          action={uploadPicture.bind(null, "cover")}
          submit={t("upload")}
          extra={
            <PendingButton
              variant="outline"
              className="min-h-10 px-4"
              disabled={!profile.cover}
              formNoValidate
              formAction={removePicture.bind(null, "cover")}
            >
              {t("remove")}
            </PendingButton>
          }
        >
          <Row label={t("coverLabel")} htmlFor="picture-cover">
            {profile.cover ? (
              <Art
                category="profileCovers"
                src={profile.cover.url}
                className="aspect-(--aspect-cover) w-full max-w-sm rounded-md border"
              />
            ) : (
              <div className="aspect-(--aspect-cover) w-full max-w-sm rounded-md border bg-muted" />
            )}
            <Input
              id="picture-cover"
              type="file"
              name="file"
              accept={ACCEPT}
              aria-describedby="picture-cover-help"
            />
            <Help id="picture-cover-help">
              {worn.coverPresetId === null
                ? t("coverHelp")
                : t("coverGalleryWorn")}
            </Help>
          </Row>
        </ActionForm>
      </div>
    </Section>
  );
}
