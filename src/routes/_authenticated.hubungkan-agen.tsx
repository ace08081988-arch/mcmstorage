/**
 * Panduan menghubungkan asisten AI (ChatGPT, Claude, Claude Code, dll.)
 * ke server MCP milik aplikasi ini. Ditulis untuk orang non-teknis:
 * salin URL, ikuti langkah per aplikasi, lalu segarkan bila ada update.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageContainer } from "@/components/shell";
import { Bot, Check, Copy, ExternalLink, RefreshCw } from "lucide-react";

const APP_NAME = "MCM Storage";
const SERVER_SLUG = "mcm-storage";

export const Route = createFileRoute("/_authenticated/hubungkan-agen")({
  head: () => ({
    meta: [
      { title: "Hubungkan asisten AI · MCM Storage" },
      {
        name: "description",
        content:
          "Panduan menghubungkan ChatGPT, Claude, atau Claude Code ke MCM Storage lewat koneksi MCP, termasuk cara menyegarkan koneksi setelah aplikasi diperbarui.",
      },
      { property: "og:title", content: "Hubungkan asisten AI · MCM Storage" },
      {
        property: "og:description",
        content:
          "Salin URL server, ikuti langkah per aplikasi, dan segarkan koneksi saat MCM Storage diperbarui.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: HubungkanAgenPage,
});

function useMcpUrl() {
  const [url, setUrl] = useState("");
  useEffect(() => {
    setUrl(new URL("/mcp", window.location.origin).toString());
  }, []);
  return url;
}

function CopyButton({ value, label = "Salin" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className="gap-ms-1.5 shrink-0"
      disabled={!value}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          toast.success("Tersalin ke papan klip");
          window.setTimeout(() => setDone(false), 1600);
        } catch {
          toast.error("Gagal menyalin — salin manual dari kotak di atas");
        }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Tersalin" : label}
    </Button>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="ml-5 list-decimal space-y-2 text-ms-sm leading-relaxed text-foreground">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ol>
  );
}

function HubungkanAgenPage() {
  const mcpUrl = useMcpUrl();
  const claudeDeepLink = mcpUrl
    ? `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent(
        APP_NAME,
      )}&connectorUrl=${encodeURIComponent(mcpUrl)}`
    : "";
  const claudeCodeCmd = mcpUrl
    ? `claude mcp add --scope user --transport http ${SERVER_SLUG} '${mcpUrl.replace(/'/g, "'\\''")}'`
    : "";

  return (
    <PageContainer ariaLabel="Hubungkan asisten AI">
      <header className="space-y-ms-2">
        <Badge variant="secondary" className="gap-ms-1.5">
          <Bot className="h-3.5 w-3.5" /> Integrasi agen
        </Badge>
        <h1 className="text-ms-xl font-semibold tracking-tight">Hubungkan asisten AI ke {APP_NAME}</h1>
        <p className="text-ms-sm leading-relaxed text-muted-foreground">
          Setelah terhubung, asisten seperti ChatGPT atau Claude bisa membantu melihat stok,
          ringkasan piutang, dan menyiapkan draf pesan untuk pembeli — langsung dari data {APP_NAME} milik
          akun Anda. Anda akan diminta masuk saat pertama kali menghubungkan.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-ms-base">Alamat server</CardTitle>
          <CardDescription className="text-ms-xs">
            Ini satu-satunya alamat yang perlu Anda tempel di aplikasi asisten.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-ms-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/50 px-ms-3 py-ms-2 font-mono text-ms-sm">
            {mcpUrl || "Memuat…"}
          </code>
          <CopyButton value={mcpUrl} label="Salin URL" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-ms-base">Cara menghubungkan</CardTitle>
          <CardDescription className="text-ms-xs">Pilih aplikasi yang Anda pakai.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="chatgpt">
            <TabsList className="flex w-full flex-wrap">
              <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
              <TabsTrigger value="claude">Claude</TabsTrigger>
              <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
              <TabsTrigger value="lain">Lainnya</TabsTrigger>
            </TabsList>

            <TabsContent value="chatgpt" className="pt-ms-4">
              <Steps
                items={[
                  <>
                    Buka{" "}
                    <a
                      className="text-primary underline underline-offset-2"
                      href="https://chatgpt.com/#settings/Connectors/Advanced"
                      target="_blank"
                      rel="noreferrer"
                    >
                      pengaturan Apps ChatGPT
                    </a>{" "}
                    lalu aktifkan <b>Developer mode</b> (perhatikan peringatan risikonya). Kalau opsinya
                    tidak ada, minta admin ChatGPT Anda mengaktifkannya.
                  </>,
                  <>Klik tombol <b>Create app</b> di sebelah tombol kembali.</>,
                  <>Isi nama koneksi (misalnya “{APP_NAME}”) lalu tempel URL server di atas.</>,
                  <>Klik <b>Create</b>.</>,
                  <>Aktifkan app tersebut dari kolom chat, lalu minta ChatGPT memakainya.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="claude" className="pt-ms-4">
              <Steps
                items={[
                  <>
                    Buka halaman penambahan koneksi Claude yang sudah terisi otomatis:{" "}
                    <a
                      className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
                      href={claudeDeepLink || "#"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Tambah {APP_NAME} ke Claude <ExternalLink className="h-3 w-3" />
                    </a>
                  </>,
                  <>Periksa detailnya, lalu klik <b>Add</b>.</>,
                  <>
                    Kalau formulir isian otomatis tidak terbuka: buka halaman <b>Connectors</b> di Claude,
                    pilih <b>Add custom connector</b>, beri nama, lalu tempel URL server di atas.
                  </>,
                  <>Aktifkan koneksinya dari kolom chat, lalu minta Claude memakainya.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="claude-code" className="space-y-ms-3 pt-ms-4">
              <Steps
                items={[
                  <>Jalankan perintah berikut di terminal:</>,
                  <>
                    Buka Claude Code lalu ketik <code className="font-mono">/mcp</code> untuk memastikan
                    {" "}{APP_NAME} sudah terhubung. Anda akan diminta masuk dari menu itu.
                  </>,
                  <>Minta Claude Code memakai {APP_NAME}.</>,
                ]}
              />
              <div className="flex flex-col gap-ms-2 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-md border border-border bg-muted/50 px-ms-3 py-ms-2 font-mono text-ms-xs">
                  {claudeCodeCmd || "Memuat…"}
                </code>
                <CopyButton value={claudeCodeCmd} label="Salin perintah" />
              </div>
            </TabsContent>

            <TabsContent value="lain" className="pt-ms-4">
              <Steps
                items={[
                  <>Buka pengaturan MCP server / custom connector di aplikasi asisten Anda.</>,
                  <>Buat koneksi ke remote MCP server.</>,
                  <>Beri nama koneksinya, lalu tempel URL server di atas.</>,
                  <>Selesaikan proses masuk / otorisasi bila diminta.</>,
                  <>Aktifkan koneksinya, lalu minta asisten memakai {APP_NAME}.</>,
                ]}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-ms-2 text-ms-base">
            <RefreshCw className="h-4 w-4" aria-hidden /> Setelah aplikasi diperbarui
          </CardTitle>
          <CardDescription className="text-ms-xs">
            Asisten menyimpan daftar kemampuan lama, jadi segarkan koneksinya agar ikut mendapat fitur
            terbaru.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="r-chatgpt">
            <TabsList className="flex w-full flex-wrap">
              <TabsTrigger value="r-chatgpt">ChatGPT</TabsTrigger>
              <TabsTrigger value="r-claude">Claude</TabsTrigger>
              <TabsTrigger value="r-claude-code">Claude Code</TabsTrigger>
              <TabsTrigger value="r-lain">Lainnya</TabsTrigger>
            </TabsList>

            <TabsContent value="r-chatgpt" className="pt-ms-4">
              <Steps
                items={[
                  <>Buka preferensi apps ChatGPT, pilih {APP_NAME} di bagian <b>Enabled apps</b>.</>,
                  <>Di samping <b>Information</b>, klik <b>Refresh</b>.</>,
                  <>Kalau URL-nya berubah, tempel URL terbaru dari kartu di atas.</>,
                  <>Mulai chat baru, lalu minta ChatGPT memakai {APP_NAME}.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="r-claude" className="pt-ms-4">
              <Steps
                items={[
                  <>Buka halaman <b>Connectors</b> lalu pilih koneksi {APP_NAME}.</>,
                  <>Segarkan / perbarui daftar kemampuan koneksinya.</>,
                  <>Kalau URL-nya berubah, tempel URL terbaru dari kartu di atas.</>,
                  <>Minta Claude memakai {APP_NAME}.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="r-claude-code" className="space-y-ms-3 pt-ms-4">
              <Steps
                items={[
                  <>Mulai sesi Claude Code baru — kemampuan terbaru dimuat saat menyambung.</>,
                  <>
                    Kalau URL-nya berubah, jalankan{" "}
                    <code className="font-mono">claude mcp remove {SERVER_SLUG}</code> lalu jalankan lagi
                    perintah pemasangan dengan URL terbaru.
                  </>,
                  <>Minta Claude Code memakai {APP_NAME}.</>,
                ]}
              />
            </TabsContent>

            <TabsContent value="r-lain" className="pt-ms-4">
              <Steps
                items={[
                  <>Buka pengaturan MCP server / connector di aplikasi asisten Anda.</>,
                  <>Pilih koneksi yang dibuat untuk {APP_NAME}.</>,
                  <>Segarkan daftar kemampuan, muat ulang server, atau sambungkan ulang.</>,
                  <>Kalau URL-nya berubah, tempel URL terbaru dari kartu di atas.</>,
                  <>Mulai chat / sesi baru, lalu minta asisten memakai {APP_NAME}.</>,
                ]}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
