import type { getTranslations } from "next-intl/server";

// The limits of a signature as `profiles.self` reports them.
export type SignatureLimits = {
  signatureMaxLinks: number;
  signatureMaxImages: number;
  signatureMaxSmilies: number;
  signatureMaxTextSize: number;
  signatureFormats: string[];
};

type Title = Awaited<ReturnType<typeof getTranslations<"account.title">>>;

// What a signature may hold, as sentences: the allowed formatting, then the limits that apply to
// it. A count of 0 or -1 is no limit, so it is not mentioned; a limit on a kind the site does not
// allow is not mentioned either.
export function signatureAllowance(
  t: Title,
  locale: string,
  limits: SignatureLimits,
): string {
  const { signatureFormats: formats } = limits;
  if (formats.length === 0) return t("signaturePlain");
  const list = new Intl.ListFormat(locale);
  const counted = [
    ["link", limits.signatureMaxLinks, "signatureLinks"],
    ["image", limits.signatureMaxImages, "signaturePictures"],
  ] as const;
  const bounds = [
    ...counted.flatMap(([kind, count, key]) =>
      formats.includes(kind) && count > 0 ? [t(key, { count })] : [],
    ),
    ...(limits.signatureMaxSmilies > 0
      ? [t("signatureEmoji", { count: limits.signatureMaxSmilies })]
      : []),
    ...(formats.some((kind) => kind === "size" || kind === "heading") &&
    limits.signatureMaxTextSize > 0
      ? [t("signatureSize", { size: limits.signatureMaxTextSize })]
      : []),
  ];
  return [
    t("signatureAllowed", {
      formats: list.format(
        formats.map((kind) =>
          t(`signatureKinds.${kind}` as "signatureKinds.bold"),
        ),
      ),
    }),
    ...(bounds.length > 0
      ? [t("signatureBounds", { bounds: list.format(bounds) })]
      : []),
  ].join(" ");
}
