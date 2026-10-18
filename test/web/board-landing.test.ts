/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerProject } from "@tachy/contract";

vi.mock("../../packages/web/src/api", () => ({ api: { get: vi.fn() } }));

const { az } = await import("../../packages/web/src/work-items/az.svelte");
const { landingProject, rememberProject } =
  await import("../../packages/web/src/work-items/board.svelte");

const project = (id: string) => ({ id, name: id }) as ComposerProject;

describe("where the board opens", () => {
  beforeEach(() => {
    localStorage.clear();
    az.projects = [project("p1"), project("p2")];
  });

  it("reopens the project last open", () => {
    rememberProject("p2");
    expect(landingProject()).toBe("p2");
  });

  it("falls back to the first project when the last is no longer the caller's", () => {
    rememberProject("gone");
    expect(landingProject()).toBe("p1");
  });

  it("has nowhere to open without projects", () => {
    az.projects = [];
    expect(landingProject()).toBeNull();
  });
});
