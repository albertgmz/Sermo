import type { Metadata } from "next";
import { StaticPage } from "@/app/(main)/(static)/static-page";

export const metadata: Metadata = {
  title: "Legal notice - forum/ui",
};

const CONTENT = `
This notice is placeholder text for a demo forum. The details below are generic examples, not a real company.

## Publisher

**forum/ui**, Example Street 1, 12345 Example City

Email: hello@example.com

## Hosting

The site is hosted by an example provider. Its name and address would be listed here.

## Content

Members are responsible for the content they publish. Posts reflect the opinion of their authors, not of the publisher.

## Reporting content

If you believe something on the forum infringes your rights, send the address of the page and a short explanation through the [contact page](/contact). Reports are reviewed by staff.

## Intellectual property

The forum name, logo and interface belong to the publisher. Content posted by members remains theirs, as described in the [terms](/terms).
`;

export default function LegalPage() {
  return (
    <StaticPage
      href="/legal"
      title="Legal notice"
      updated="September 1, 2026"
      content={CONTENT}
    />
  );
}
