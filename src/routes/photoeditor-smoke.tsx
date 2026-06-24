import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PhotoEditor } from "@/components/PhotoEditor";

export const Route = createFileRoute("/photoeditor-smoke")({
  component: PhotoEditorSmoke,
});

function PhotoEditorSmoke() {
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("init");

  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = 400; c.height = 300;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 400, 300);
    g.addColorStop(0, "#ef4444"); g.addColorStop(1, "#3b82f6");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = "#fff"; ctx.font = "bold 40px sans-serif";
    ctx.fillText("TEST IMG", 70, 170);
    setSrc(c.toDataURL("image/png"));
    setStatus("ready");
  }, []);

  if (!src) return <div data-testid="smoke-status">{status}</div>;
  return (
    <div data-testid="smoke-mounted">
      <PhotoEditor
        src={src}
        onCancel={() => setStatus("cancelled")}
        onSave={() => setStatus("saved")}
      />
    </div>
  );
}