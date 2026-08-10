import { describe, it, expect } from "vitest";
import {
  emptyScene, serializeScene, deserializeScene, newId,
  visibleObjectsForExport,
  type ImageObj, type Scene, type ShapeObj,
} from "./scene";
import { initHistory, pushHistory, undo, redo, readScene, canUndo, canRedo } from "./history";

const imgObj = (): ImageObj => ({
  id: newId("i"),
  kind: "image",
  src: "data:image/png;base64,iVBORw0KGgo=",
  x: 10, y: 20, width: 300, height: 200, rotation: 12.5, opacity: 0.8,
  naturalWidth: 1600, naturalHeight: 1067,
  visible: true, locked: false,
});

const shapeObj = (): ShapeObj => ({
  id: "s1", kind: "shape", shape: "rect",
  x: 0, y: 0, width: 50, height: 50, rotation: 0,
  stroke: "#fff", strokeWidth: 4, opacity: 1,
});

describe("scene: objek foto tambahan", () => {
  it("round-trip serialize/deserialize mempertahankan semua field", () => {
    const s = emptyScene(1000, 800);
    const o = imgObj();
    s.objects.push(o);
    const back = deserializeScene(serializeScene(s), emptyScene(0, 0));
    expect(back.objects).toHaveLength(1);
    expect(back.objects[0]).toEqual(o);
  });

  it("scene lama tanpa objek image tetap ter-deserialize (backward compatible)", () => {
    const legacy = JSON.stringify({
      version: 1, width: 640, height: 480, rotation: 0,
      objects: [shapeObj()],
    });
    const back = deserializeScene(legacy, emptyScene(0, 0));
    expect(back.width).toBe(640);
    expect(back.objects[0].kind).toBe("shape");
  });

  it("layer foto ikut diekspor bersama anotasi, layer tersembunyi tidak", () => {
    const hidden: ImageObj = { ...imgObj(), id: "hidden", visible: false };
    const s: Scene = { ...emptyScene(100, 100), objects: [shapeObj(), imgObj(), hidden] };
    const out = visibleObjectsForExport(s);
    expect(out.map((o) => o.kind)).toEqual(["shape", "image"]);
    expect(out.find((o) => o.id === "hidden")).toBeUndefined();
  });
});

describe("undo/redo di sekitar penyisipan foto", () => {
  it("undo membuang layer foto, redo mengembalikannya utuh", () => {
    const base = emptyScene(800, 600);
    let h = initHistory(base);
    const o = imgObj();
    const withImage: Scene = { ...base, objects: [o] };
    h = pushHistory(h, withImage);
    expect(readScene(h).objects).toHaveLength(1);
    expect(canUndo(h)).toBe(true);

    h = undo(h);
    expect(readScene(h).objects).toHaveLength(0);
    expect(canRedo(h)).toBe(true);

    h = redo(h);
    expect(readScene(h).objects[0]).toEqual(o);
  });
});
