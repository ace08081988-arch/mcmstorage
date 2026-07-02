import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ImagePlus, Type as TypeIcon, Loader2, Globe, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  insertStatus,
  uploadStatusMedia,
  statusSignedUrl,
  getDefaultStatusVisibility,
  type StatusVisibility,
} from "@/lib/status";

export const Route = createFileRoute("/_authenticated/status/baru")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Buat Status · MCM Storage" },
      { name: "description", content: "Unggah foto, video, atau tulis teks untuk status Anda." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: BuatStatusPage,
});

function BuatStatusPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"media" | "text">("media");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [bg, setBg] = useState("#0f172a");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [visibility, setVisibility] = useState<StatusVisibility>("public");

  useEffect(() => {
    let alive = true;
    getDefaultStatusVisibility().then((v) => {
      if (alive) setVisibility(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  const pickFile = () => fileRef.current?.click();

  const onPick = (f: File | null) => {
    if (!f) return;
    if (!/^image\/|^video\//.test(f.type)) {
      toast.error("Format harus foto atau video");
      return;
    }
    if (f.size > 30 * 1024 * 1024) {
      toast.error("Ukuran maksimum 30 MB");
      return;
    }
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const submit = async () => {
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) {
        toast.error("Sesi tidak aktif");
        return;
      }
      if (mode === "text") {
        const trimmed = caption.trim();
        if (!trimmed) {
          toast.error("Tulis dulu teks status");
          return;
        }
        const row = await insertStatus({
          media_url: "",
          media_path: "",
          media_type: "text",
          caption: trimmed,
          bg_color: bg,
          visibility,
        });
        if (!row) {
          toast.error("Gagal menyimpan status");
          return;
        }
        toast.success("Status terkirim");
        navigate({ to: "/pembaruan" });
        return;
      }
      if (!file) {
        toast.error("Pilih foto atau video dulu");
        return;
      }
      const ext = (file.name.split(".").pop() || (file.type.startsWith("video/") ? "mp4" : "jpg")).toLowerCase();
      const path = await uploadStatusMedia(uid, file, ext);
      if (!path) {
        toast.error("Gagal upload media");
        return;
      }
      const signed = (await statusSignedUrl(path)) ?? "";
      const row = await insertStatus({
        media_url: signed,
        media_path: path,
        media_type: file.type.startsWith("video/") ? "video" : "image",
        caption: caption.trim() || null,
        visibility,
      });
      if (!row) {
        toast.error("Gagal menyimpan status");
        return;
      }
      toast.success("Status terkirim");
      navigate({ to: "/pembaruan" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-3 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Kembali"
          onClick={() => navigate({ to: "/pembaruan" })}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="text-lg font-semibold">Buat Status</h1>
      </header>
      <main className="flex-1 space-y-4 p-4">
        <div className="flex gap-2">
          <Button
            variant={mode === "media" ? "default" : "outline"}
            onClick={() => setMode("media")}
            className="flex-1"
          >
            <ImagePlus className="mr-2 size-4" />
            Foto / Video
          </Button>
          <Button
            variant={mode === "text" ? "default" : "outline"}
            onClick={() => setMode("text")}
            className="flex-1"
          >
            <TypeIcon className="mr-2 size-4" />
            Teks
          </Button>
        </div>

        <fieldset className="rounded-2xl border p-3">
          <legend className="px-1 text-xs font-medium text-muted-foreground">
            Siapa yang bisa melihat
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setVisibility("public")}
              aria-pressed={visibility === "public"}
              className="flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm aria-[pressed=true]:border-primary aria-[pressed=true]:bg-primary/10"
            >
              <Globe className="size-4" />
              <div>
                <div className="font-medium">Semua orang</div>
                <div className="text-[11px] text-muted-foreground">
                  Semua pengguna aplikasi
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setVisibility("friends")}
              aria-pressed={visibility === "friends"}
              className="flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm aria-[pressed=true]:border-primary aria-[pressed=true]:bg-primary/10"
            >
              <Users className="size-4" />
              <div>
                <div className="font-medium">Teman saja</div>
                <div className="text-[11px] text-muted-foreground">
                  Kontak yang diterima
                </div>
              </div>
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Ubah default di{" "}
            <button
              type="button"
              className="underline"
              onClick={() => navigate({ to: "/pengaturan-privasi" })}
            >
              Pengaturan Privasi
            </button>
            .
          </p>
        </fieldset>

        {mode === "media" ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={pickFile}
              className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed bg-muted/40"
            >
              {previewUrl ? (
                file?.type.startsWith("video/") ? (
                  <video src={previewUrl} className="size-full object-cover" controls />
                ) : (
                  <img src={previewUrl} alt="Preview" className="size-full object-cover" />
                )
              ) : (
                <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                  <ImagePlus className="size-8" />
                  Ketuk untuk pilih foto/video
                </div>
              )}
            </button>
            <Textarea
              placeholder="Tambah keterangan (opsional)…"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={500}
            />
          </>
        ) : (
          <>
            <div
              className="flex min-h-[280px] items-center justify-center rounded-2xl p-6 text-center text-2xl font-semibold text-white"
              style={{ background: bg }}
            >
              {caption || "Tulis sesuatu…"}
            </div>
            <Textarea
              placeholder="Tulis status teks…"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={500}
              rows={4}
            />
            <div className="flex flex-wrap gap-2">
              {["#0f172a", "#1e293b", "#065f46", "#7c2d12", "#4c1d95", "#831843"].map(
                (c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Latar ${c}`}
                    onClick={() => setBg(c)}
                    className="size-9 rounded-full ring-2 ring-transparent aria-[pressed=true]:ring-primary"
                    aria-pressed={bg === c}
                    style={{ background: c }}
                  />
                ),
              )}
            </div>
          </>
        )}

        <Button
          onClick={submit}
          disabled={busy || (mode === "media" ? !file : !caption.trim())}
          className="w-full"
        >
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          Kirim status
        </Button>
      </main>
    </div>
  );
}