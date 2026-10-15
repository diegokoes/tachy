/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FONT_KEYS } from "@tachy/contract";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("../../packages/web/src/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  api,
}));

const { applyOrgDefaults, clearOrgDefaults, saveOrgDefaults } =
  await import("../../packages/web/src/theme/defaults");
const { FAMILIES, fontState } =
  await import("../../packages/web/src/theme/fonts.svelte");
const { orgAppearance } =
  await import("../../packages/web/src/theme/org.svelte");
const { resetAccent, setNavLabels, themeState } =
  await import("../../packages/web/src/theme/theme.svelte");

const ORG = {
  theme: "light",
  text_size: "large",
  nav_labels: "both",
  accent: "#0dbc79",
  font_mono: "jetbrains",
};

const reply = (value: unknown) => ({ settings: { appearance: { value } } });
const root = document.documentElement;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  applyOrgDefaults({});
});

describe("org appearance defaults", () => {
  it("paint every field this browser has not saved", () => {
    applyOrgDefaults(ORG);
    expect(themeState).toMatchObject({
      theme: "light",
      fontScale: 1.35,
      navLabels: "both",
      accentColor: "#0dbc79",
      accentCustomized: false,
    });
    expect(root.dataset.theme).toBe("light");
    expect(fontState.mono).toBe("jetbrains");
  });

  it("give way to a saved choice", () => {
    setNavLabels("icons");
    applyOrgDefaults(ORG);
    expect(themeState.navLabels).toBe("icons");
  });

  it("are not written into the reader's own choices", () => {
    applyOrgDefaults(ORG);
    expect(Object.keys(localStorage)).toEqual(["tachy-org-appearance"]);
  });

  it("are where a reset accent lands", () => {
    applyOrgDefaults(ORG);
    resetAccent();
    expect(themeState.accentColor).toBe("#0dbc79");
  });

  it("swap a grey accent that vanishes in the reader's mode", () => {
    localStorage.setItem("tachy-theme", "dark");
    applyOrgDefaults({ theme: "light", accent: "#000000" });
    expect(themeState.accentColor).toBe("#ffffff");
  });

  it("publish the admin's look", async () => {
    setNavLabels("icons");
    api.put.mockResolvedValue(reply({ nav_labels: "icons" }));
    await saveOrgDefaults();
    const [path, body] = api.put.mock.calls[0];
    expect(path).toBe("/settings/appearance");
    expect(body.value).toMatchObject({
      theme: "dark",
      nav_labels: "icons",
      font_ui: "plex-sans",
    });
    expect(body.value).not.toHaveProperty("accent2");
    expect(orgAppearance.value).toEqual({ nav_labels: "icons" });
  });

  it("once cleared, leave the built-in look on unsaved fields", async () => {
    applyOrgDefaults(ORG);
    api.delete.mockResolvedValue(reply({}));
    api.get.mockRejectedValue(new Error("offline"));
    await clearOrgDefaults();
    expect(themeState).toMatchObject({
      theme: "dark",
      fontScale: 1,
      navLabels: "text",
      accentColor: "#6ea8fe",
    });
    expect(fontState.mono).toBe("plex-mono");
  });
});

describe("FAMILIES", () => {
  it("offers exactly the faces the contract allows", () => {
    for (const axis of ["ui", "prose", "mono"] as const) {
      expect(FAMILIES[axis].map((f) => f.key)).toEqual([...FONT_KEYS[axis]]);
    }
  });
});
