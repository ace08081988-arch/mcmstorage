import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { TemplateEntry } from "./registry";

export interface ShipmentStatusUpdateProps {
  customerName?: string;
  itemName?: string;
  qty?: string | number;
  statusKey: "disiapkan" | "dikirim" | "selesai";
  referenceNote?: string;
  storeName?: string;
}

const STATUS_COPY: Record<
  ShipmentStatusUpdateProps["statusKey"],
  { headline: string; body: string; preview: string }
> = {
  disiapkan: {
    headline: "Pesanan Anda sedang disiapkan",
    body: "Tim kami sedang menyiapkan pesanan Anda. Kami akan mengabari lagi begitu paket dikirim.",
    preview: "Pesanan Anda sedang kami siapkan",
  },
  dikirim: {
    headline: "Pesanan Anda sudah dikirim",
    body: "Paket Anda sudah dikirim dan sedang dalam perjalanan. Mohon siap menerima ya.",
    preview: "Pesanan Anda sudah dikirim",
  },
  selesai: {
    headline: "Pesanan Anda sudah selesai",
    body: "Terima kasih! Pesanan Anda tercatat sudah diterima. Jika ada kendala, silakan balas email ini.",
    preview: "Pesanan Anda sudah selesai",
  },
};

const ShipmentStatusUpdate: React.FC<ShipmentStatusUpdateProps> = ({
  customerName,
  itemName,
  qty,
  statusKey,
  referenceNote,
  storeName,
}) => {
  const copy = STATUS_COPY[statusKey] ?? STATUS_COPY.dikirim;
  const shop = storeName || "Ace Storage";
  const salutation = customerName ? `Halo ${customerName},` : "Halo,";
  return (
    <Html lang="id" dir="ltr">
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>{copy.headline}</Heading>
          <Text style={paragraph}>{salutation}</Text>
          <Text style={paragraph}>{copy.body}</Text>
          {(itemName || qty) && (
            <Section style={detailCard}>
              {itemName && (
                <Text style={detailLine}>
                  <strong>Barang:</strong> {itemName}
                </Text>
              )}
              {qty !== undefined && qty !== null && qty !== "" && (
                <Text style={detailLine}>
                  <strong>Jumlah:</strong> {String(qty)}
                </Text>
              )}
              {referenceNote && (
                <Text style={detailLine}>
                  <strong>Catatan:</strong> {referenceNote}
                </Text>
              )}
            </Section>
          )}
          <Text style={paragraph}>Terima kasih sudah berbelanja di {shop}.</Text>
          <Text style={footer}>{shop}</Text>
        </Container>
      </Body>
    </Html>
  );
};

const main: React.CSSProperties = {
  backgroundColor: "#ffffff",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};
const container: React.CSSProperties = { padding: "24px", maxWidth: "560px" };
const heading: React.CSSProperties = { color: "#0f172a", fontSize: "22px", margin: "0 0 16px" };
const paragraph: React.CSSProperties = { color: "#334155", fontSize: "15px", lineHeight: "22px", margin: "0 0 12px" };
const detailCard: React.CSSProperties = { backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "16px", margin: "16px 0" };
const detailLine: React.CSSProperties = { color: "#0f172a", fontSize: "14px", margin: "4px 0" };
const footer: React.CSSProperties = { color: "#64748b", fontSize: "13px", marginTop: "24px" };

export const template = {
  component: ShipmentStatusUpdate,
  subject: (data: Record<string, unknown>) => {
    const key = (data.statusKey as ShipmentStatusUpdateProps["statusKey"]) ?? "dikirim";
    return STATUS_COPY[key]?.headline ?? "Update pesanan Anda";
  },
  displayName: "Update status pengiriman",
  previewData: {
    customerName: "Budi",
    itemName: "Karton Beras 5kg",
    qty: "2 pcs",
    statusKey: "dikirim",
    storeName: "Ace Storage",
  },
} satisfies TemplateEntry;
