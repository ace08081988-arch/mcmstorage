import { useEffect, useState } from "react";
import { Building2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  useOrgName,
  setOrgName,
  DEFAULT_ORG_NAME,
  DEFAULT_ORG_SHORT,
} from "@/lib/org-name";

export function OrgNameSettings() {
  const { full: savedFull, short: savedShort } = useOrgName();
  const [full, setFull] = useState(savedFull);
  const [short, setShort] = useState(savedShort);

  useEffect(() => {
    setFull(savedFull);
    setShort(savedShort);
  }, [savedFull, savedShort]);

  const dirty = full.trim() !== savedFull || short.trim() !== savedShort;

  const onSave = () => {
    setOrgName(full, short);
    toast.success("Nama organisasi disimpan");
  };

  const onReset = () => {
    setOrgName(DEFAULT_ORG_NAME, DEFAULT_ORG_SHORT);
    toast.success("Dikembalikan ke bawaan");
  };

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
          <CardTitle className="text-base">Nama organisasi</CardTitle>
        </div>
        <CardDescription>
          Muncul di header (sidebar) dan footer publik aplikasi.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="org-full">Nama lengkap</Label>
          <Input
            id="org-full"
            value={full}
            onChange={(e) => setFull(e.target.value)}
            placeholder={DEFAULT_ORG_NAME}
            maxLength={60}
            className="h-10"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-short">Singkatan / lencana</Label>
          <Input
            id="org-short"
            value={short}
            onChange={(e) => setShort(e.target.value.toUpperCase().slice(0, 6))}
            placeholder={DEFAULT_ORG_SHORT}
            maxLength={6}
            className="h-10 uppercase tracking-wider"
          />
          <p className="text-[11px] text-muted-foreground">
            Maks. 6 karakter, dipakai untuk kotak logo kecil di sidebar.
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="text-xs"
          >
            Reset ke bawaan
          </Button>
          <Button
            type="button"
            onClick={onSave}
            disabled={!dirty || !full.trim()}
            className="gap-2"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Simpan
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}