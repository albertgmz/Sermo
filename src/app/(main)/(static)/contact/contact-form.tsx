"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ContactForm() {
  const [submitted, setSubmitted] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
      className="mt-8 space-y-4 rounded-lg border bg-card p-4"
    >
      <h2 className="text-base font-semibold">Send a message</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="contact-name">Name</Label>
          <Input id="contact-name" name="name" autoComplete="name" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contact-email">Email</Label>
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
        <Label htmlFor="contact-message">Message</Label>
        <Textarea
          id="contact-message"
          name="message"
          required
          className="min-h-32"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="h-10 px-4 md:h-8 md:px-3">
          Send
        </Button>
        <output className="text-sm text-muted-foreground">
          {submitted && "This demo does not send messages."}
        </output>
      </div>
    </form>
  );
}
