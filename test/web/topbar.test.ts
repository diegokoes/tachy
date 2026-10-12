import { beforeEach, describe, expect, it } from "vitest";
import {
  topbar,
  tuckTopbar,
  unveilTopbar,
  veilTopbar,
} from "../../packages/web/src/shell/topbar.svelte";

beforeEach(() => {
  topbar.tucked = false;
  topbar.veiled = false;
});

describe("the tucked top bar", () => {
  it("stays in its row until a view asks for the room", () => {
    expect(topbar).toEqual({ tucked: false, veiled: false });
  });

  it("is tucked for as long as the view that asked holds on to it", () => {
    const release = tuckTopbar();
    expect(topbar.tucked).toBe(true);
    release();
    expect(topbar.tucked).toBe(false);
  });

  it("comes back unseen when it was veiled, and shows when unveiled", () => {
    const release = tuckTopbar();
    veilTopbar();
    release();
    expect(topbar).toEqual({ tucked: false, veiled: true });
    unveilTopbar();
    expect(topbar.veiled).toBe(false);
  });

  // A message sent while the bar is still veiled tucks it again; a veil left
  // set would keep it unseen once the pointer asks for it.
  it("drops a veil when it is tucked again", () => {
    veilTopbar();
    tuckTopbar();
    expect(topbar).toEqual({ tucked: true, veiled: false });
  });
});
