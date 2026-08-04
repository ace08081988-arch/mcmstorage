// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import { focusablesInOrder, nextFocusInOrder, resolveTabTarget } from "@/lib/focus-order";

/** happy-dom tidak menghitung layout, jadi visibilitas dipaksa true. */
const opts = { isVisible: () => true, skip: (el: HTMLElement) => el.dataset["scroll"] === "1" };

function mountDialog(editing: boolean) {
  document.body.innerHTML = `
    <button id="outside">luar</button>
    <div id="dialog" role="dialog">
      <div data-scroll="1" tabindex="-1"></div>
      <button id="close">Tutup</button>
      ${
        editing
          ? `<textarea id="editor"></textarea><button id="done">Selesai</button>`
          : `<pre id="pretext" role="button" tabindex="0"></pre><button id="edit">Edit</button>`
      }
      <button id="send">Kirim</button>
    </div>`;
  return document.getElementById("dialog") as HTMLElement;
}

const ids = (root: HTMLElement) => focusablesInOrder(root, opts).map((el) => el.id);

describe("urutan tab dialog pratinjau", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("mode baca punya urutan DOM yang stabil", () => {
    expect(ids(mountDialog(false))).toEqual(["close", "pretext", "edit", "send"]);
  });

  it("edit -> baca: posisi Tab lanjut di slot yang sama, tidak meloncat ke awal", () => {
    let root = mountDialog(true);
    expect(ids(root)).toEqual(["close", "editor", "done", "send"]);
    // fokus di textarea (slot ke-2)
    const editor = document.getElementById("editor") as HTMLElement;
    editor.focus();
    expect(nextFocusInOrder(root, editor, false, opts)?.id).toBe("done");

    // keluar mode edit -> textarea diganti <pre>, fokus mendarat di pre
    root = mountDialog(false);
    const pre = document.getElementById("pretext") as HTMLElement;
    pre.focus();
    expect(nextFocusInOrder(root, pre, false, opts)?.id).toBe("edit");
    expect(nextFocusInOrder(root, pre, true, opts)?.id).toBe("close");
    // tidak melompat ke awal dialog
    expect(nextFocusInOrder(root, pre, false, opts)?.id).not.toBe("close");
  });

  it("menggulung di ujung daftar, maju dan mundur", () => {
    const root = mountDialog(false);
    const send = document.getElementById("send") as HTMLElement;
    const close = document.getElementById("close") as HTMLElement;
    expect(resolveTabTarget(root, send, false, opts)?.id).toBe("close");
    expect(resolveTabTarget(root, close, true, opts)?.id).toBe("send");
    expect(resolveTabTarget(root, document.getElementById("edit") as HTMLElement, false, opts)).toBeNull();
  });

  it("fokus di luar dialog ditarik kembali sesuai arah Tab", () => {
    const root = mountDialog(false);
    const outside = document.getElementById("outside") as HTMLElement;
    expect(resolveTabTarget(root, outside, false, opts)?.id).toBe("close");
    expect(resolveTabTarget(root, outside, true, opts)?.id).toBe("send");
    expect(resolveTabTarget(root, null, false, opts)?.id).toBe("close");
  });

  it("tutup lalu buka lagi: urutan direset ke awal, bukan sisa render lama", () => {
    const first = mountDialog(true);
    (document.getElementById("editor") as HTMLElement).focus();
    document.body.innerHTML = ""; // dialog ditutup
    const second = mountDialog(false); // dibuka lagi (mode baca)
    expect(second).not.toBe(first);
    expect(ids(second)).toEqual(["close", "pretext", "edit", "send"]);
    expect(resolveTabTarget(second, null, false, opts)?.id).toBe("close");
    const close = document.getElementById("close") as HTMLElement;
    expect(nextFocusInOrder(second, close, false, opts)?.id).toBe("pretext");
    expect(resolveTabTarget(second, close, true, opts)?.id).toBe("send");
  });

  it("layer portal (select/popover) tidak digulung balik ke dialog", () => {
    const root = mountDialog(false);
    const layer = document.createElement("div");
    layer.setAttribute("role", "listbox");
    layer.innerHTML = `<button id="opt">Opsi</button>`;
    document.body.appendChild(layer);
    const opt = document.getElementById("opt") as HTMLElement;
    expect(resolveTabTarget(root, opt, false, opts)).toBeNull();
  });
});

describe("isFocusableNow", () => {
  it("menolak elemen disabled, aria-disabled, hidden, dan inert", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button id="ok">ok</button>
      <button id="dis" disabled>dis</button>
      <button id="aria" aria-disabled="true">aria</button>
      <button id="hid" hidden>hid</button>
      <div aria-hidden="true"><button id="ah">ah</button></div>
    `;
    document.body.appendChild(root);
    const q = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
    expect(isFocusableNow(q("ok"))).toBe(true);
    expect(isFocusableNow(q("dis"))).toBe(false);
    expect(isFocusableNow(q("aria"))).toBe(false);
    expect(isFocusableNow(q("hid"))).toBe(false);
    expect(isFocusableNow(q("ah"))).toBe(false);
    expect(isFocusableNow(null)).toBe(false);
    root.remove();
  });
});
