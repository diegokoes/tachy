import {
  parseAppearanceDefaults,
  type AppearanceDefaults,
} from "@tachy/contract";

const STORAGE_KEY = "tachy-org-appearance";

function cached(): AppearanceDefaults {
  try {
    return parseAppearanceDefaults(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"),
    );
  } catch {
    return {};
  }
}

/**
 * The deployment's defaults, seeded from the last copy this browser saw so a
 * reload does not paint the built-in look before the server answers.
 */
export const orgAppearance = $state<{ value: AppearanceDefaults }>({
  value: cached(),
});

export function rememberOrgAppearance(raw: unknown) {
  orgAppearance.value = parseAppearanceDefaults(raw);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orgAppearance.value));
  } catch {
    // storage blocked: the next boot asks the server again
  }
}
