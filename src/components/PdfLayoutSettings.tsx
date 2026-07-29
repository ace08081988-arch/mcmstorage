import { FileText, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  usePdfPrefs,
  setPdfPrefs,
  resetPdfPrefs,
  type PdfDensity,
} from "@/lib/pdf-prefs";

const DENSITY: Array<{ value: PdfDensity; label: string; hint: string }> = [
  { value: "rapat", label: "Rapat", hint: "Margin kecil, muat banyak baris" },
  { value: "normal", label: "Normal", hint: "Setelan bawaan" },
  { value: "lega", label: "Lega", hint: "Margin luas, enak dibaca" },
];

export function PdfLayoutSettings() {
  const prefs = usePdfPrefs();

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          <CardTitle className="text-ms-base">Tata letak PDF ekspor</CardTitle>
        </div>
        <CardDescription>
          Atur kerapatan margin dan skala font untuk semua ekspor PDF
          (ringkasan analytics, transaksi harian, auto-kirim).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Kerapatan margin</Label>
          <div className="grid grid-cols-3 gap-2">
            {DENSITY.map((d) => {
              const active = prefs.density === d.value;
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setPdfPrefs({ density: d.value })}
                  aria-pressed={active}
                  className={`min-h-11 rounded-lg border px-2 py-2 text-left transition ${
                    active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <span className="block text-sm font-medium">{d.label}</span>
                  <span className="block text-[11px] leading-tight">{d.hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="pdf-font-scale">Skala font</Label>
            <span className="text-sm tabular-nums text-muted-foreground">
              {Math.round(prefs.fontScale * 100)}%
            </span>
          </div>
          <Slider
            id="pdf-font-scale"
            min={0.8}
            max={1.3}
            step={0.05}
            value={[prefs.fontScale]}
            onValueChange={(v) => setPdfPrefs({ fontScale: v[0] })}
          />
          <p className="text-xs text-muted-foreground">
            80% = padat (banyak data per halaman) · 130% = besar (mudah dibaca).
          </p>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="mb-2 text-xs text-muted-foreground">Pratinjau kerapatan</p>
          <div
            className="rounded border border-border bg-background"
            style={{
              padding: `${prefs.density === "rapat" ? 6 : prefs.density === "lega" ? 18 : 12}px`,
            }}
          >
            <div
              className="space-y-1"
              style={{ fontSize: `${11 * prefs.fontScale}px` }}
            >
              <div className="font-semibold">Ringkasan analytics</div>
              <div className="flex justify-between"><span>Omzet</span><span>Rp 1.250.000</span></div>
              <div className="flex justify-between"><span>Transaksi</span><span>12</span></div>
              <div className="flex justify-between"><span>Unit terjual</span><span>34</span></div>
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => {
            resetPdfPrefs();
            toast.success("Tata letak PDF dikembalikan ke bawaan");
          }}
        >
          <RotateCcw className="mr-2 size-4" />
          Kembalikan ke bawaan
        </Button>
      </CardContent>
    </Card>
  );
}
