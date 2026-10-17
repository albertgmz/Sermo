import {
  Coins,
  FileText,
  FolderTree,
  House,
  type LucideIcon,
  Megaphone,
  Palette,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import type { SectionId } from "./registry";

// The pictures of the panel's sections, for the navigation (a client component, so kept apart from
// the screens' pictures in `icons.ts`) and the home. Not in the registry, which the proxy reads.
export const SECTION_ICONS: Record<SectionId, LucideIcon> = {
  home: House,
  setup: Settings,
  content: FileText,
  forums: FolderTree,
  communication: Megaphone,
  users: Users,
  groups: Shield,
  appearance: Palette,
  economy: Coins,
  tools: Wrench,
  logs: ScrollText,
  moderation: ShieldCheck,
};
