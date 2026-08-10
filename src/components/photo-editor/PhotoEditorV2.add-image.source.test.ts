/**
 * Assertion sumber: picker "Tambah Foto" WAJIB lewat suppression app-lock,
 * kalau tidak pemilik disambut layar App Lock saat kembali dari kamera.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(
  path.resolve(process.cwd(), "src/components/photo-editor/PhotoEditorV2.tsx"),
  "utf8",
);

describe("PhotoEditorV2 — tambah foto", () => {
  it("mengimpor dan memakai openFilePickerWithLock", () => {
    expect(src).toMatch(/import\s*\{\s*openFilePickerWithLock\s*\}\s*from\s*"@\/lib\/app-lock"/);
    expect(src).toMatch(/openFilePickerWithLock\(\s*input\s*,/);
  });

  it("tidak pernah memanggil input.click() langsung (bypass app-lock)", () => {
    expect(src).not.toMatch(/(cameraInputRef|galleryInputRef|input)\.(current\.)?click\(\)/);
  });

  it("menyediakan dua sumber picker: kamera dan galeri", () => {
    expect(src).toContain('capture="environment"');
    expect(src).toContain("Tambah Foto — Kamera");
    expect(src).toContain("Tambah Foto — Galeri");
  });

  it("Simpan dinonaktifkan selama foto tambahan masih di-decode", () => {
    expect(src).toMatch(/onClick=\{doSave\}[\s\S]{0,120}disabled=\{addingImage\}/);
    expect(src).toMatch(/if \(addingImageRef\.current\) \{[\s\S]{0,200}return;/);
  });

  it("melepas suppression app-lock saat editor ditutup", () => {
    expect(src).toMatch(/useEffect\(\(\) => \(\) => \{ releasePicker\(\); \}/);
  });

  it("hanya PhotoEditorV2 yang diubah — legacy tidak mengenal image layer", () => {
    const legacy = readFileSync(path.resolve(process.cwd(), "src/components/PhotoEditor.tsx"), "utf8");
    expect(legacy).not.toContain("openFilePickerWithLock");
  });
});
