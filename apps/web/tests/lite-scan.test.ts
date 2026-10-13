import { expect, test } from "bun:test";
import { artCategoryErrors, emissionHits } from "./lite-scan";

test("the emission scanner recognizes every forbidden syntax, including multiline forms", () => {
  const examples = [
    "<img src={url} />",
    'import Photo from "next/image"',
    "<Image src={url} />",
    "<AvatarImage src={url} />",
    "<picture />",
    "<source src={url} />",
    "<video poster={url} />",
    "const props = { srcSet: value }",
    "style={{ backgroundImage: value }}",
    ".art { background-image: var(--picture) }",
    'const style = { "background-image": value }',
    '.art { background:\n center / cover url("/external.png") }',
    '.art { mask: url("picture.svg") }',
    '.art { mask-image: url("picture.svg") }',
    '.art { border-image: url("picture.svg") 30 }',
    '.art { list-style: url("picture.svg") }',
    '.art { cursor: url("picture.svg"), auto }',
    '.art::after { content: url("picture.svg") }',
    'style={{ maskImage: "url(picture.svg)" }}',
    'className="hover:bg-[url(/external.png)]"',
    '<link\n as="image"\n rel="preload" href={url} />',
    '<link rel={"preload"} as={"image"} href={url} />',
    '<link rel="icon" href={url} />',
    "const metadata = { icons: { icon: url } }",
    'const metadata = { "openGraph": { images: [url] } }',
    "const metadata = { twitter: { images: [url] } }",
    "const picture = new Image()",
    "<svg><image href={url} /></svg>",
    '<svg><use\n href="#picture" /></svg>',
    'const path = "/pictures/new.jpg"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Source code is the scanner input.
    "const path = `/media/${id}.png`",
    'const path = "/banner.jpg"',
    'const path = "/mark.svg"',
    'const path = "/brand.svg"',
  ];
  for (const example of examples)
    expect(
      emissionHits("example.tsx", example).length,
      `Uncaught emission: ${example}`,
    ).toBeGreaterThan(0);
  expect(emissionHits("example.tsx", "\n\n<img src={url} />")[0].line).toBe(3);
});

test("picture file paths in CSS strings require a gate too", () => {
  for (const source of [
    ':root { --picture: "/pictures/new.jpg" }',
    ":root { --picture: '/media/new.jpg' }",
    ':root { --picture: "https://forum.test/pictures/new.png" }',
  ])
    expect(emissionHits("example.css", source).length, source).toBeGreaterThan(
      0,
    );
});

test("ordinary routes, gradients and similarly named icons do not look like pictures", () => {
  for (const source of [
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Source code is the scanner input.
    "<Link href={`/forums/${forum.id}`} />",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Source code is the scanner input.
    "revalidatePath(`/forums/${forum.id}`)",
    '<Link href="/awards/12" />',
    'type Props = PageProps<"/forums/[id]/new">',
    'import { Form } from "@/app/(main)/forums/form"',
    "<ImagePlus />",
    'className="[mask-image:linear-gradient(to_bottom,black,transparent)]"',
    ".art { background: linear-gradient(transparent, currentColor) }",
  ])
    expect(emissionHits("example.tsx", source), source).toEqual([]);
});

test("Art scan handles aliases, multiline props, expressions, invalid keys and spreads", () => {
  for (const source of [
    "<Art src={url} />",
    '<Art category="typo" src={url} />',
    "<Art category={value} src={url} />",
    '<Art category={condition ? "shop" : "typo"} src={url} />',
    "<Art {...props} />",
    '<Art category="avatars" {...props} />',
    'import { Art as Cover } from "@/components/forum/art";\n<Cover src={url} />',
    'import * as Pictures from "@/components/forum/art";\n<Pictures.Art src={url} />',
  ])
    expect(
      artCategoryErrors("example.tsx", source).length,
      source,
    ).toBeGreaterThan(0);
  for (const source of [
    '<Art\n category="avatars" src={url} />',
    '<Art category={"frames"} src={url} />',
    '<Art category={condition ? "threadCovers" : "shop"} src={url} />',
    '<Art {...props} category="profileCovers" />',
    'import { Art as Cover } from "./art"; <Cover category="threadCovers" src={url} />',
  ])
    expect(artCategoryErrors("example.tsx", source), source).toEqual([]);
});
