/**
 * Evaluasi ambang Core Web Vitals lapangan dan pemicu peringatan otomatis.
 *
 * Dipakai dua pemanggil: cron publik (`/api/public/hooks/web-vitals-monitor`)
 * dan tombol "Periksa sekarang" di dashboard admin. Logika dipisah ke modul
 * `.server` supaya tidak pernah ikut ke bundel browser.
 *
 * Aturan: p75 dihitung per (halaman × metrik) dalam jendela waktu terakhir,
 * hanya bila jumlah sampel mencukupi, dan tiap kunci punya cooldown supaya
 * satu regresi tidak membanjiri email.
 */

export type AlertMetric = "LCP" | "CLS" | "INP";
export type AlertPage = "katalog_list" | "katalog_detail";

export type AlertFired = {
  page: AlertPage;
  metric: AlertMetric;
  p75: number;
  threshold: number;
  samples: number;
  severity: "warning" | "critical";
  message: string;
  deliveryStatus: string;
  telegramStatus: string;
  slackStatus: string;
};

export type AlertCheckResult = {
  ok: boolean;
  skipped?: string;
  checkedAt: string;
  evaluated: {
    page: AlertPage;
    metric: AlertMetric;
    p75: number | null;
    samples: number;
    threshold: number;
    breached: boolean;
  }[];
  fired: AlertFired[];
};

const PAGES: AlertPage[] = ["katalog_list", "katalog_detail"];
const METRICS: AlertMetric[] = ["LCP", "CLS", "INP"];

const PAGE_LABEL: Record<AlertPage, string> = {
  katalog_list: "Halaman katalog",
  katalog_detail: "Detail produk",
};

function p75(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.75) - 1);
  return sorted[Math.max(0, idx)] ?? null;
}

function fmt(metric: AlertMetric, v: number): string {
  return metric === "CLS" ? v.toFixed(3) : `${(v / 1000).toFixed(2)} s`;
}

const GATEWAY = "https://connector-gateway.lovable.dev";

/** Kirim pesan ke Telegram lewat connector gateway. */
async function sendTelegram(chatId: string, text: string): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  const conn = process.env["TELEGRAM_API_KEY"];
  if (!apiKey || !conn) return "skipped_no_credentials";
  try {
    const res = await fetch(`${GATEWAY}/telegram/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Connection-Api-Key": conn,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const body = await res.text();
    if (!res.ok) return `failed_${res.status}: ${body.slice(0, 200)}`;
    const json = JSON.parse(body) as { ok?: boolean; description?: string };
    return json.ok ? "sent" : `failed: ${json.description ?? "unknown"}`;
  } catch (e) {
    return `failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Kirim pesan ke channel Slack lewat connector gateway. */
async function sendSlack(channel: string, text: string): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  const conn = process.env["SLACK_API_KEY"];
  if (!apiKey || !conn) return "skipped_no_credentials";
  try {
    const res = await fetch(`${GATEWAY}/slack/api/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Connection-Api-Key": conn,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel, text }),
    });
    const body = await res.text();
    if (!res.ok) return `failed_${res.status}: ${body.slice(0, 200)}`;
    const json = JSON.parse(body) as { ok?: boolean; error?: string };
    return json.ok ? "sent" : `failed: ${json.error ?? "unknown"}`;
  } catch (e) {
    return `failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Jalankan satu siklus pemeriksaan ambang; menulis riwayat & mengirim email. */
export async function runWebVitalsAlertCheck(): Promise<AlertCheckResult> {
  const checkedAt = new Date().toISOString();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: cfg } = await supabaseAdmin
    .from("web_vital_alert_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (!cfg) return { ok: false, skipped: "no_config", checkedAt, evaluated: [], fired: [] };
  if (!cfg.enabled) {
    await supabaseAdmin
      .from("web_vital_alert_config")
      .update({ last_check_at: checkedAt })
      .eq("id", 1);
    return { ok: true, skipped: "disabled", checkedAt, evaluated: [], fired: [] };
  }

  const windowMinutes = Number(cfg.window_minutes) || 180;
  const cooldownMs = (Number(cfg.cooldown_minutes) || 180) * 60_000;
  const minSamples = Number(cfg.min_samples) || 20;
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const thresholds: Record<AlertMetric, number> = {
    LCP: Number(cfg.lcp_threshold_ms) || 2500,
    CLS: Number(cfg.cls_threshold) || 0.1,
    INP: Number(cfg.inp_threshold_ms) || 200,
  };

  const { data: rowsRaw } = await supabaseAdmin
    .from("web_vital_samples")
    .select("page, metric, value")
    .gte("created_at", since)
    .in("metric", METRICS)
    .limit(50_000);
  const rows = (rowsRaw ?? []) as { page: string; metric: string; value: number }[];

  const evaluated: AlertCheckResult["evaluated"] = [];
  const breaches: { page: AlertPage; metric: AlertMetric; p75: number; samples: number }[] = [];

  for (const page of PAGES) {
    for (const metric of METRICS) {
      const values = rows
        .filter((r) => r.page === page && r.metric === metric)
        .map((r) => Number(r.value));
      const v = values.length >= minSamples ? p75(values) : null;
      const breached = v != null && v > thresholds[metric];
      evaluated.push({
        page,
        metric,
        p75: v,
        samples: values.length,
        threshold: thresholds[metric],
        breached,
      });
      if (breached && v != null) breaches.push({ page, metric, p75: v, samples: values.length });
    }
  }

  const fired: AlertFired[] = [];

  for (const b of breaches) {
    // Cooldown per kunci (halaman × metrik).
    const { data: last } = await supabaseAdmin
      .from("web_vital_alerts")
      .select("created_at")
      .eq("page", b.page)
      .eq("metric", b.metric)
      .eq("device", "all")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.created_at && Date.now() - new Date(last.created_at).getTime() < cooldownMs) continue;

    const threshold = thresholds[b.metric];
    const ratio = threshold > 0 ? b.p75 / threshold : 1;
    const severity: "warning" | "critical" = ratio >= 1.5 ? "critical" : "warning";
    const message =
      `${b.metric} p75 di ${PAGE_LABEL[b.page]} memburuk: ${fmt(b.metric, b.p75)} ` +
      `(ambang ${fmt(b.metric, threshold)}) dari ${b.samples} sampel dalam ${windowMinutes} menit terakhir.`;

    let deliveryStatus = "skipped";
    let deliveryError: string | null = null;
    const apiKey = process.env["LOVABLE_API_KEY"];
    const to = cfg.admin_email;

    if (to && apiKey && cfg.email_enabled !== false) {
      try {
        const { sendLovableEmail } = await import("@lovable.dev/email-js");
        const domain = process.env["SENDER_DOMAIN"] ?? "notify.mcmstorage.biz";
        await sendLovableEmail(
          {
            to,
            from: `alerts@${domain}`,
            sender_domain: domain,
            subject: `[ALERT] ${b.metric} ${PAGE_LABEL[b.page]} melewati ambang`,
            html:
              `<h2>Peringatan Core Web Vitals</h2><p>${message}</p>` +
              `<p style="color:#888;font-size:12px">Dikirim oleh web-vitals-monitor • ${checkedAt}</p>`,
            text: message,
            purpose: "transactional",
            label: "web-vitals-alert",
            idempotency_key: `cwv-${b.page}-${b.metric}-${Math.floor(Date.now() / cooldownMs)}`,
            message_id: `cwv-${b.page}-${b.metric}-${Date.now()}`,
          },
          { apiKey, sendUrl: process.env["LOVABLE_SEND_URL"] },
        );
        deliveryStatus = "sent";
      } catch (e) {
        deliveryStatus = "failed";
        deliveryError = e instanceof Error ? e.message : String(e);
      }
    }

    await supabaseAdmin.from("web_vital_alerts").insert({
      page: b.page,
      metric: b.metric,
      device: "all",
      p75: b.p75,
      threshold,
      samples: b.samples,
      window_minutes: windowMinutes,
      severity,
      message,
      notified_email: to ?? null,
      delivery_status: deliveryStatus,
      delivery_error: deliveryError,
      telegram_status: telegramStatus,
      slack_status: slackStatus,
    });

    fired.push({
      page: b.page,
      metric: b.metric,
      p75: b.p75,
      threshold,
      samples: b.samples,
      severity,
      message,
      deliveryStatus,
      telegramStatus,
      slackStatus,
    });
  }

  await supabaseAdmin
    .from("web_vital_alert_config")
    .update({ last_check_at: checkedAt })
    .eq("id", 1);

  return { ok: true, checkedAt, evaluated, fired };
}