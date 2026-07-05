import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import {
  saveDraftPhotos,
  loadDraftPhotos,
  clearDraftPhotos,
  itemDraftKey,
  requestDraftKey,
} from "./prep-draft-store";

function makeBlob(text: string, type = "image/jpeg"): Blob {
  return new Blob([text], { type });
}

async function readText(b: Blob): Promise<string> {
  return await new Response(b).text();
}

describe("prep-draft-store", () => {
  beforeEach(async () => {
    // Fresh DB antar tes
    await clearDraftPhotos("k1");
    await clearDraftPhotos("k2");
  });

  it("kunci draft berbeda per item & request", () => {
    expect(itemDraftKey("tok", "abc")).toBe("prep-draft:tok:item:abc");
    expect(requestDraftKey("tok", "TID")).toBe("prep-draft:tok:request:TID");
  });

  it("simpan lalu muat kembali blob apa adanya", async () => {
    const blobs = [makeBlob("foto-1"), makeBlob("foto-2", "image/png")];
    await saveDraftPhotos("k1", blobs);
    const loaded = await loadDraftPhotos("k1");
    expect(loaded).toHaveLength(2);
    expect(await readText(loaded[0])).toBe("foto-1");
    expect(await readText(loaded[1])).toBe("foto-2");
    expect(loaded[1].type).toBe("image/png");
  });

  it("kunci berbeda tidak saling menimpa", async () => {
    await saveDraftPhotos("k1", [makeBlob("a")]);
    await saveDraftPhotos("k2", [makeBlob("b")]);
    expect(await readText((await loadDraftPhotos("k1"))[0])).toBe("a");
    expect(await readText((await loadDraftPhotos("k2"))[0])).toBe("b");
  });

  it("simpan array kosong = clear", async () => {
    await saveDraftPhotos("k1", [makeBlob("x")]);
    await saveDraftPhotos("k1", []);
    expect(await loadDraftPhotos("k1")).toEqual([]);
  });

  it("clearDraftPhotos menghapus draft", async () => {
    await saveDraftPhotos("k1", [makeBlob("x")]);
    await clearDraftPhotos("k1");
    expect(await loadDraftPhotos("k1")).toEqual([]);
  });

  it("loadDraftPhotos untuk kunci tidak dikenal → []", async () => {
    expect(await loadDraftPhotos("nope")).toEqual([]);
  });
});