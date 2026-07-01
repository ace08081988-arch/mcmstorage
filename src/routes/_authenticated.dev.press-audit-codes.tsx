import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getPressAuditRegistry,
  PRESS_AUDIT_DOCS_BASE,
} from "@/lib/press-audit";

export const Route = createFileRoute(
  "/_authenticated/dev/press-audit-codes",
)({
  head: () => ({
    meta: [
      { title: "Daftar Kode PA00X — Dev Tools" },
      {
        name: "description",
        content:
          "Referensi kode press-audit (PA00X) aktif: rule, deskripsi singkat, dan tautan langsung ke bagian docs/press-scope.md.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: PressAuditCodesPage,
});

const DOCS_REPO_BASE =
  "https://github.com/lovable-dev/mcm-storage/blob/main/";

function docHref(docsRelPath: string): string {
  // docsRelPath = "docs/press-scope.md#anchor"
  return `${DOCS_REPO_BASE}${docsRelPath}`;
}

function PressAuditCodesPage() {
  const entries = getPressAuditRegistry();
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Daftar Kode PA00X</h1>
        <p className="text-sm text-muted-foreground">
          Registry runtime dari <code>press-audit</code>. Kode di sini
          selalu sinkron dengan <code>src/lib/press-audit.ts</code>.
          Untuk detail lengkap dan cheat-sheet, buka{" "}
          <a
            className="underline"
            href={docHref(PRESS_AUDIT_DOCS_BASE)}
            target="_blank"
            rel="noreferrer"
          >
            {PRESS_AUDIT_DOCS_BASE}
          </a>
          .
        </p>
      </header>

      <Card data-press-audit-skip="PA001">
        <CardHeader>
          <CardTitle className="text-base">
            {entries.length} kode aktif
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Kode</TableHead>
                <TableHead className="w-56">Rule</TableHead>
                <TableHead>Deskripsi singkat</TableHead>
                <TableHead className="w-28">Docs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.code}>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono">
                      {e.code}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{e.rule}</code>
                  </TableCell>
                  <TableCell className="text-sm">
                    {e.description}
                  </TableCell>
                  <TableCell>
                    <a
                      className="text-sm underline"
                      href={docHref(e.docs)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Buka anchor
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Kode fallback & alokasi baru
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <Badge variant="outline" className="font-mono">
              PA000
            </Badge>{" "}
            digunakan untuk warning rule yang tidak dikenal atau token{" "}
            <code>data-press-audit-skip</code> yang salah format /
            belum dialokasikan.
          </p>
          <p>
            Kode <code className="font-mono">PA005+</code> belum
            dialokasikan. Ikuti panduan{" "}
            <a
              className="underline"
              href={docHref(
                "docs/press-scope.md#menambahkan-rule-baru-pa005",
              )}
              target="_blank"
              rel="noreferrer"
            >
              Menambahkan rule baru (PA005+)
            </a>{" "}
            saat menambahkan rule baru.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
