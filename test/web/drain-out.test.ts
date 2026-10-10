/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ScrollTrigger reads matchMedia as the gsap module registers it, which jsdom
// does not have.
const media = vi.hoisted(() => {
  const media = { reduced: false };
  const noop = () => {};
  window.matchMedia = (() => ({
    get matches() {
      return media.reduced;
    },
    addListener: noop,
    removeListener: noop,
    addEventListener: noop,
    removeEventListener: noop,
  })) as unknown as typeof window.matchMedia;
  return media;
});

import { gsap } from "../../packages/web/src/motion/gsap";
import { drainOut } from "../../packages/web/src/motion/motion";

function mount(html: string) {
  document.body.innerHTML = html;
  return {
    text: Array.from(document.querySelectorAll<HTMLElement>(".text")),
    boxes: Array.from(document.querySelectorAll<HTMLElement>(".box")),
  };
}

const TRANSCRIPT = `<p class="text">clear the chat</p><div class="box">card</div>`;

beforeEach(() => {
  media.reduced = false;
});
afterEach(() => {
  document.body.replaceChildren();
  gsap.globalTimeline.clear();
});

describe("drainOut", () => {
  it("finishes at once under reduced motion", () => {
    media.reduced = true;
    const { text, boxes } = mount(TRANSCRIPT);
    const done = vi.fn();
    expect(drainOut(text, boxes, done)).toBeNull();
    expect(done).toHaveBeenCalledOnce();
    expect(text[0].children).toHaveLength(0);
  });

  it("finishes at once with nothing to drain", () => {
    const done = vi.fn();
    expect(drainOut([], [], done)).toBeNull();
    expect(done).toHaveBeenCalledOnce();
  });

  it("clips every word away from the top and fades the boxes", () => {
    const { text, boxes } = mount(TRANSCRIPT);
    const done = vi.fn();
    const tl = drainOut(text, boxes, done)!;
    const words = Array.from(text[0].children) as HTMLElement[];
    expect(words.map((w) => w.textContent)).toEqual(["clear", "the", "chat"]);
    expect(done).not.toHaveBeenCalled();

    tl.progress(0.999);
    expect(words.every((w) => w.style.clipPath.startsWith("inset("))).toBe(
      true,
    );
    expect(boxes[0].style.opacity).toBe("0");

    tl.progress(1);
    expect(done).toHaveBeenCalledOnce();
    expect(text[0].innerHTML).toBe("clear the chat");
  });

  it("stays under a second however long the transcript is", () => {
    const { text, boxes } = mount(
      `<p class="text">${"word ".repeat(2000)}</p><div class="box"></div>`,
    );
    expect(drainOut(text, boxes, () => {})!.duration()).toBeLessThan(1);
  });
});
