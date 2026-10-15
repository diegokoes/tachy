import { afterEach, describe, expect, it } from "vitest";
import {
  skyTint,
  tintSky,
  type SkyTint,
} from "../../packages/web/src/motion/sky.svelte";

const AMBER = "amber" as SkyTint;

describe("the sky tint", () => {
  const releases: (() => void)[] = [];
  const claim = (tint: SkyTint) => {
    const release = tintSky(tint);
    releases.push(release);
    return release;
  };

  afterEach(() => {
    for (const release of releases.splice(0)) release();
  });

  it("is untinted with no claim", () => {
    expect(skyTint()).toBeNull();
  });

  it("follows a claim until it is released", () => {
    const release = claim("red");
    expect(skyTint()).toBe("red");
    release();
    expect(skyTint()).toBeNull();
  });

  it("shows the latest claim and falls back to the one beneath", () => {
    claim("red");
    const releaseAmber = claim(AMBER);
    expect(skyTint()).toBe(AMBER);
    releaseAmber();
    expect(skyTint()).toBe("red");
  });

  it("keeps the latest claim when an earlier one is released", () => {
    const releaseRed = claim("red");
    claim(AMBER);
    releaseRed();
    expect(skyTint()).toBe(AMBER);
  });

  it("removes nothing else when a release runs twice", () => {
    claim("red");
    const releaseAmber = claim(AMBER);
    releaseAmber();
    releaseAmber();
    expect(skyTint()).toBe("red");
  });
});
