import type { nodesGet } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Art } from "@/components/forum/art";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { PictureField } from "@/components/staff/picture-field";
import { saveNodePictures } from "../actions";

type Node = z.output<typeof nodesGet.output>["node"];

// The icon and the cover of a node. Each is uploaded as soon as it is chosen; saving attaches
// what was chosen and detaches what was removed. The current picture goes through `Art`, so LITE
// mode replaces it with a placeholder here as on the public site.
export async function PicturesForm({ node }: { node: Node }) {
  const t = await getTranslations("adminForums.pictures");
  return (
    <FormRows
      action={saveNodePictures}
      id="pictures"
      heading={t("heading")}
      description={t("description")}
      submit={t("save")}
    >
      <input type="hidden" name="id" value={node.id} />
      <FieldRow
        name="icon"
        label={t("icon")}
        htmlFor="node-icon"
        help={t("iconHelp")}
      >
        <PictureField
          purpose="node_icon"
          name="icon"
          id="node-icon"
          removable
          current={
            node.icon ? (
              <Art
                src={node.icon.url}
                category="forumArt"
                className="size-16 rounded-lg"
              />
            ) : undefined
          }
        />
      </FieldRow>
      <FieldRow
        name="cover"
        label={t("cover")}
        htmlFor="node-cover"
        help={t("coverHelp")}
      >
        <PictureField
          purpose="node_cover"
          name="cover"
          id="node-cover"
          removable
          current={
            node.cover ? (
              <Art
                src={node.cover.url}
                category="forumArt"
                className="h-20 w-40 rounded-lg"
              />
            ) : undefined
          }
        />
      </FieldRow>
    </FormRows>
  );
}
