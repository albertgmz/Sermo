import { getTranslations } from "next-intl/server";
import { removePicture } from "@/app/(main)/account/actions";
import { getSelf, getWorn } from "@/app/(main)/account/data";
import {
  Notice,
  noticeOf,
  type SearchParams,
} from "@/app/(main)/account/notice";
import { Help, Row, Section } from "@/app/(main)/account/section";
import { Art } from "@/components/forum/art";
import { UserAvatar } from "@/components/forum/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The types and the size a picture may have are a setting of the site: the backend checks and
// re-encodes the picture and says why if it refuses it.
const ACCEPT = "image/*";

// A picture goes to the route handler of ./picture, which streams it on to the backend: a
// server action would hold the whole body. The page is left and comes back with the notice, so
// the form needs no script. Removing is a form of its own: the chosen file must not go with it.
function PictureForm({
  kind,
  submit,
  remove,
  canRemove,
  children,
}: {
  kind: "avatar" | "cover";
  submit: string;
  remove: string;
  canRemove: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <form
        method="post"
        action={`/account/picture?kind=${kind}`}
        encType="multipart/form-data"
      >
        <div className="divide-y">{children}</div>
        <div className="flex flex-wrap items-center gap-3 border-t p-4">
          <Button type="submit" className="min-h-10 px-4">
            {submit}
          </Button>
          <Button
            type="submit"
            variant="outline"
            form={`remove-${kind}`}
            disabled={!canRemove}
            className="min-h-10 px-4"
          >
            {remove}
          </Button>
        </div>
      </form>
      <form id={`remove-${kind}`} action={removePicture.bind(null, kind)} />
    </>
  );
}

export async function PicturesSection({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [t, self, worn, notice] = await Promise.all([
    getTranslations("account.pictures"),
    getSelf(),
    getWorn(),
    noticeOf(
      searchParams,
      ["avatar", "avatarRemoved", "cover", "coverRemoved"],
      ["avatar", "cover", "pictures"],
    ),
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
        <PictureForm
          kind="avatar"
          submit={t("upload")}
          remove={t("remove")}
          canRemove={Boolean(profile.avatar)}
        >
          <Row label={t("avatarLabel")} htmlFor="picture-avatar">
            <UserAvatar user={profile.card} size="2xl" link={false} />
            <Input
              id="picture-avatar"
              type="file"
              name="file"
              accept={ACCEPT}
              required
              aria-describedby="picture-avatar-help"
            />
            <Help id="picture-avatar-help">{t("avatarHelp")}</Help>
          </Row>
        </PictureForm>
      </div>
      <div id="cover" className="scroll-mt-4 border-t">
        <PictureForm
          kind="cover"
          submit={t("upload")}
          remove={t("remove")}
          canRemove={Boolean(profile.cover)}
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
              required
              aria-describedby="picture-cover-help"
            />
            <Help id="picture-cover-help">
              {worn.coverPresetId === null
                ? t("coverHelp")
                : t("coverGalleryWorn")}
            </Help>
          </Row>
        </PictureForm>
      </div>
    </Section>
  );
}
