"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Editor } from "@/components/forum/editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ContactForm() {
  const t = useTranslations("static.contactForm");
  const [submitted, setSubmitted] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
      className="mt-8 space-y-4 rounded-lg border bg-card p-4"
    >
      <h2 className="text-base font-semibold">{t("heading")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="contact-name">{t("nameLabel")}</Label>
          <Input id="contact-name" name="name" autoComplete="name" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contact-email">{t("emailLabel")}</Label>
          <Input
            id="contact-email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label id="contact-message-label" htmlFor="contact-message">
          {t("messageLabel")}
        </Label>
        <Editor
          id="contact-message"
          aria-labelledby="contact-message-label"
          name="message"
          required
          minHeight={128}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="h-10 px-4 md:h-8 md:px-3">
          {t("submit")}
        </Button>
        <output className="text-sm text-muted-foreground">
          {submitted && t("confirmation")}
        </output>
      </div>
    </form>
  );
}
