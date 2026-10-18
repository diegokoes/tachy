import {
  TEXT_SIZES,
  parseAppearanceDefaults,
  type AppearanceDefaults,
} from "@tachy/contract";
import { api } from "../api";
import { dateFormat, loadDateFormat } from "../dates.svelte";
import { fontState, loadFonts } from "./fonts.svelte";
import { rememberOrgAppearance } from "./org.svelte";
import { loadTheme, themeState } from "./theme.svelte";

/** Stores the deployment's defaults and repaints every field not saved here. */
export function applyOrgDefaults(raw: unknown) {
  rememberOrgAppearance(raw);
  loadTheme();
  loadFonts();
}

function currentLook(): AppearanceDefaults {
  return parseAppearanceDefaults({
    theme: themeState.theme,
    text_size: TEXT_SIZES.find((t) => t.scale === themeState.fontScale)?.key,
    nav_labels: themeState.navLabels,
    accent: themeState.accentColor,
    accent2: themeState.accentColor2,
    font_ui: fontState.ui,
    font_prose: fontState.prose,
    font_mono: fontState.mono,
    date_order: dateFormat.order,
    clock: dateFormat.clock,
  });
}

type SettingsReply = { settings: { appearance: { value: unknown } } };

/** Makes the admin's current look what everyone without their own sees. */
export async function saveOrgDefaults() {
  const reply = await api.put<SettingsReply>("/settings/appearance", {
    value: currentLook(),
  });
  applyOrgDefaults(reply.settings.appearance.value);
}

export async function clearOrgDefaults() {
  const reply = await api.delete<SettingsReply>("/settings/appearance");
  applyOrgDefaults(reply.settings.appearance.value);
  await loadDateFormat();
}
