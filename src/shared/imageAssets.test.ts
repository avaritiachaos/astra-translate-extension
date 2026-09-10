import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { imageDataUrlToBlob, imageBlobToDataUrl } from "./imageAssets.ts";
describe("image input boundaries", () => {
  it("round trips binary bytes including non-ASCII values", async () => {
    const input = new Blob([new Uint8Array([0, 128, 255, 42])], {
      type: "image/png",
    });
    const output = imageDataUrlToBlob(await imageBlobToDataUrl(input));
    assert.equal(output.type, "image/png");
    assert.deepEqual(
      new Uint8Array(await output.arrayBuffer()),
      new Uint8Array([0, 128, 255, 42]),
    );
  });
  it("rejects remote URLs, active image formats and invalid base64", () => {
    for (const input of [
      "https://private.example/image",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png;base64,!!",
    ])
      assert.throws(() => imageDataUrlToBlob(input));
  });
  it("enforces decoded size including base64 padding", () => {
    assert.equal(imageDataUrlToBlob("data:image/png;base64,AA==", 1).size, 1);
    assert.throws(
      () => imageDataUrlToBlob("data:image/png;base64,AAAA", 2),
      /IMAGE_TOO_LARGE/,
    );
  });
});
