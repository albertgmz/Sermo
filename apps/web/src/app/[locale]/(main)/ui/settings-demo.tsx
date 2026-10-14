"use client";

import { useState } from "react";
import { saveSetting } from "@/app/[locale]/(main)/ui/actions";
import { AutosaveForm, ChoiceForm } from "@/components/forum/autosave";
import { FramingDialog } from "@/components/forum/framing-dialog";
import {
  SettingsGroup,
  SettingsLinkRow,
  SettingsRow,
} from "@/components/forum/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Shape } from "@/lib/framing";

const CHOICES = ["Red", "Blue", "Green"];

// The settings screen's pieces with a sample backend: a value over twenty characters is refused.
export function SettingsDemo() {
  const [file, setFile] = useState<File | null>(null);
  const [shape, setShape] = useState<Shape>("avatar");
  const [framed, setFramed] = useState("");
  const [choice, setChoice] = useState("Red");
  return (
    <div className="max-w-xl space-y-4">
      <SettingsGroup
        heading="Profile"
        description="Rows save by themselves; empty a field that had text to get an Undo."
      >
        <AutosaveForm
          action={saveSetting}
          title="Custom title"
          description="Saves after a pause or when you leave the field. Over 20 characters is refused."
          htmlFor="demo-title"
        >
          <Input id="demo-title" name="title" defaultValue="Captain" />
        </AutosaveForm>
        <ChoiceForm
          action={async (data) => {
            setChoice(String(data.get("value")));
            return saveSetting(data);
          }}
          title="Accent"
          description="Choices save when pressed."
        >
          <div className="flex flex-wrap gap-2">
            {CHOICES.map((name) => (
              <Button
                key={name}
                type="submit"
                name="value"
                value={name}
                variant="outline"
                aria-pressed={choice === name}
                className="min-h-10 px-4 aria-pressed:border-primary"
              >
                {name}
              </Button>
            ))}
          </div>
        </ChoiceForm>
        <SettingsRow
          title="Avatar"
          description="Choose a picture to frame it. Nothing is uploaded here."
          status={
            framed && (
              <output className="text-xs text-muted-foreground">
                {framed}
              </output>
            )
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Frame shape"
              value={shape}
              onChange={(event) => setShape(event.target.value as Shape)}
              className="h-10 rounded-lg border border-input bg-card px-2.5 text-sm"
            >
              <option value="avatar">Avatar (square)</option>
              <option value="cover">Cover (5:2)</option>
            </select>
            <input
              type="file"
              accept="image/*"
              aria-label="Picture to frame"
              className="min-w-0 text-sm"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
          </div>
          <FramingDialog
            file={file}
            shape={shape}
            limit={null}
            onClose={() => setFile(null)}
            onConfirm={async (blob, name) => {
              setFramed(`${name}: ${blob.type}, ${blob.size} bytes`);
              return { ok: true };
            }}
          />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup heading="More settings">
        <SettingsLinkRow href="/ui">Privacy</SettingsLinkRow>
        <SettingsLinkRow href="/ui">Notifications</SettingsLinkRow>
      </SettingsGroup>
    </div>
  );
}
