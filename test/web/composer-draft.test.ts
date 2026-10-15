/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerProject } from "@tachy/contract";

vi.mock("../../packages/web/src/api", () => ({
  api: { get: vi.fn(async () => []) },
  ApiError: class extends Error {},
}));

const {
  closeComposer,
  composer,
  discardAndLeave,
  hasDraft,
  openComposer,
  saveDraft,
} = await import("../../packages/web/src/work-items/composer.svelte");
const { router } = await import("../../packages/web/src/shell/router.svelte");

const STORE = "tachy.az.draft";
const portal = { id: "p1", name: "Portal" } as ComposerProject;

describe("the board's composer", () => {
  beforeEach(async () => {
    localStorage.clear();
    await openComposer(portal);
    composer.title = "Print preview is blank";
  });

  it("opens on the board, remembering where it was asked from", async () => {
    expect(router.path).toBe("/board/azure-devops/new");
    expect(composer.openedFrom).toBe("board");
    await openComposer(null, null, { from: "chat" });
    expect(composer.openedFrom).toBe("chat");
    expect(composer.project?.id).toBe("p1");
  });

  it("sets the draft aside on close and goes back to the project's list", () => {
    closeComposer();
    expect(router.path).toBe("/board/azure-devops/p1");
    expect(JSON.parse(localStorage.getItem(STORE)!)).toMatchObject({
      title: "Print preview is blank",
    });
    expect(hasDraft()).toBe(true);
  });

  it("drops the draft whole on discard and stays dropped", () => {
    saveDraft();
    discardAndLeave();
    expect(router.path).toBe("/board/azure-devops/p1");
    expect(composer.project).toBeNull();
    expect(composer.title).toBe("");
    expect(hasDraft()).toBe(false);
    saveDraft();
    expect(localStorage.getItem(STORE)).toBeNull();
  });
});
