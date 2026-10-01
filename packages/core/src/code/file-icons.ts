import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * File-type icons from the Material Icon Theme (MIT), the set VS Code users
 * know. Its manifest is 440 KB, so it is read here and the browser is only
 * handed icon ids and the SVGs it actually draws.
 */
type Manifest = {
  iconDefinitions: Record<string, { iconPath: string }>;
  fileExtensions: Record<string, string>;
  file: string;
  light?: { fileExtensions?: Record<string, string> };
};

const require = createRequire(import.meta.url);
const MANIFEST_PATH =
  require.resolve("material-icon-theme/dist/material-icons.json");

let manifest: Manifest | undefined;
const theme = (): Manifest => (manifest ??= require(MANIFEST_PATH) as Manifest);

export interface FileIcon {
  icon: string;
  icon_light: string | null;
}

/** The icon for files ending `.<ext>`; the theme's plain file when it has none. */
export function fileIconOf(ext: string): FileIcon {
  const m = theme();
  const key = ext.toLowerCase();
  return {
    icon: m.fileExtensions[key] ?? m.file,
    icon_light: m.light?.fileExtensions?.[key] ?? null,
  };
}

/** Where an icon's SVG lives on disk; null for an id the theme does not define. */
export function fileIconPath(id: string): string | null {
  const def = Object.hasOwn(theme().iconDefinitions, id)
    ? theme().iconDefinitions[id]
    : undefined;
  return def ? join(dirname(MANIFEST_PATH), def.iconPath) : null;
}
