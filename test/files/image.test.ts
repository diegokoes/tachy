import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MODEL_IMAGE_MAX_EDGE_PX, imageForModel } from "@tachy/core/files";
import { picture } from "../fixtures/files";

describe("imageForModel", () => {
  it("fits a large image inside the longest edge a model is given", async () => {
    const image = await imageForModel(await picture(3000, 1500));
    expect(image).toMatchObject({
      mimeType: "image/png",
      widthPx: MODEL_IMAGE_MAX_EDGE_PX,
      heightPx: 1000,
    });
    const tall = await imageForModel(await picture(500, 4000, "jpeg"));
    expect(tall).toMatchObject({ widthPx: 250, heightPx: 2000 });
  });

  it("leaves a small image its size, and each format lossy or lossless as it came", async () => {
    expect(await imageForModel(await picture(320, 200, "jpeg"))).toMatchObject({
      mimeType: "image/jpeg",
      widthPx: 320,
      heightPx: 200,
    });
    expect(
      (await imageForModel(await picture(320, 200, "webp"))).mimeType,
    ).toBe("image/webp");
    expect((await imageForModel(await picture(64, 64, "gif"))).mimeType).toBe(
      "image/png",
    );
  });

  it("turns a photo upright and leaves its metadata behind", async () => {
    const sideways = await sharp({
      create: { width: 400, height: 200, channels: 3, background: "#336699" },
    })
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Copyright: "someone" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(sideways).metadata()).exif).toBeDefined();

    const image = await imageForModel(new Uint8Array(sideways));
    expect(image).toMatchObject({ widthPx: 200, heightPx: 400 });
    const written = await sharp(image.bytes).metadata();
    expect(written.exif).toBeUndefined();
    expect(written.orientation).toBeUndefined();
  });

  it("refuses bytes that are not an image it can decode", async () => {
    const png = await picture(100, 100);
    await expect(imageForModel(png.slice(0, 40))).rejects.toThrow(
      /the image cannot be read/,
    );
    await expect(
      imageForModel(new TextEncoder().encode("not an image")),
    ).rejects.toThrow(/the image cannot be read/);
  });

  it("refuses an image that is small on disk and vast once decoded", async () => {
    const bomb = await picture(8000, 7000);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    await expect(imageForModel(bomb)).rejects.toThrow(
      /the image cannot be read/,
    );
  });
});
