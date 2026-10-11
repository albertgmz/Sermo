import type { Metadata } from "next";
import { ContactForm } from "@/app/(main)/(static)/contact/contact-form";
import { StaticPage } from "@/app/(main)/(static)/static-page";

export const metadata: Metadata = {
  title: "Contact - forum/ui",
};

const CONTENT = `
The details below are placeholders for a demo forum.

## Contact details

- **General questions**: hello@example.com
- **Account and moderation**: support@example.com
- **Postal address**: Example Street 1, 12345 Example City

Staff usually answer within two working days. For anything about a specific post, include a link to it.
`;

export default function ContactPage() {
  return (
    <StaticPage
      href="/contact"
      title="Contact"
      updated="September 1, 2026"
      content={CONTENT}
    >
      <ContactForm />
    </StaticPage>
  );
}
