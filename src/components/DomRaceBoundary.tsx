import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

/** Nama event global untuk memicu pemulihan boundary dari mana saja. */
export const DOM_RACE_RESET_EVENT = "mcm:dom-race-reset";

/**
 * Pemulihan cepat tanpa reload halaman: kirim sinyal ke boundary (semua,
 * atau hanya yang `label`-nya cocok) supaya subtree-nya di-remount bersih.
 * Dipakai tombol "Pulihkan komponen" di fallback maupun di toolbar halaman.
 */
export function requestDomRaceReset(label?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DOM_RACE_RESET_EVENT, { detail: { label } }));
}

export type DomRaceFallbackInfo = {
  /** Berapa kali auto-retry sudah dijalankan. */
  attempt: number;
  /** true bila auto-retry sudah habis → butuh aksi manual pengguna. */
  exhausted: boolean;
};

/**
 * Boundary untuk race DOM transien di Android WebView.
 *
 * Gejala: `NotFoundError: Failed to execute 'removeChild' on 'Node'` —
 * React mencoba melepas node yang sudah tidak lagi jadi anak parent-nya
 * (mis. karena WebView/translator/extension memindahkan node, atau karena
 * portal + list besar ter-unmount di tengah commit). Ini bukan bug logika
 * halaman: render ulang di tick berikutnya hampir selalu bersih.
 *
 * Strategi: tangkap error, retry otomatis dengan backoff (tanpa reload
 * halaman penuh), dan hanya tampilkan fallback bila tetap gagal.
 */
export class DomRaceBoundary extends Component<
  {
    children: ReactNode;
    label?: string;
    renderFallback?: (error: Error, reset: () => void, info: DomRaceFallbackInfo) => ReactNode;
  },
  { error: Error | null; attempt: number; remountKey: number; exhausted: boolean }
> {
  state = { error: null as Error | null, attempt: 0, remountKey: 0, exhausted: false };
  private retryTimer: number | null = null;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  private handleReset = () => {
    this.clearTimer();
    this.setState((prev) => ({
      error: null,
      attempt: 0,
      exhausted: false,
      remountKey: prev.remountKey + 1,
    }));
  };

  /**
   * Sinyal pemulihan eksternal. Tidak memfilter apa pun bila event dikirim
   * tanpa label → semua boundary ikut pulih (tombol "pemulihan cepat" global).
   */
  private handleResetSignal = (ev: Event) => {
    const label = (ev as CustomEvent<{ label?: string }>).detail?.label;
    if (label && label !== this.props.label) return;
    this.handleReset();
  };

  componentDidMount() {
    if (typeof window !== "undefined") {
      window.addEventListener(DOM_RACE_RESET_EVENT, this.handleResetSignal);
    }
  }

  private clearTimer() {
    if (this.retryTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(
      `[${this.props.label ?? "DomRaceBoundary"}] render failed`,
      error,
      info.componentStack,
    );
    const msg = `${error?.message ?? ""} ${error?.name ?? ""}`;
    const isDomRace =
      /removeChild|insertBefore|appendChild|NotFoundError|The node to be removed|Failed to execute/i.test(
        msg,
      );
    const maxAttempts = isDomRace ? 5 : 1;
    if (this.state.attempt < maxAttempts && typeof window !== "undefined") {
      this.clearTimer();
      const delay = 150 + this.state.attempt * 250;
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null;
        this.setState((prev) => ({
          error: null,
          attempt: prev.attempt + 1,
          // Remount bersih: state internal yang mungkin korup ikut di-reset.
          remountKey: prev.remountKey + 1,
        }));
      }, delay);
    } else {
      // Auto-retry habis → fallback wajib menawarkan tombol pemulihan manual.
      this.setState({ exhausted: true });
    }
  }

  componentWillUnmount() {
    this.clearTimer();
    if (typeof window !== "undefined") {
      window.removeEventListener(DOM_RACE_RESET_EVENT, this.handleResetSignal);
    }
  }

  render() {
    const { error } = this.state;
    if (error) {
      const info: DomRaceFallbackInfo = {
        attempt: this.state.attempt,
        exhausted: this.state.exhausted,
      };
      if (this.props.renderFallback)
        return this.props.renderFallback(error, this.handleReset, info);
      return (
        <div className="mx-auto max-w-md space-y-3 p-6 text-center">
          <p className="text-base font-semibold">Tampilan sempat gagal dimuat</p>
          <p className="text-sm text-muted-foreground break-words">{error.message}</p>
          <button
            type="button"
            onClick={this.handleReset}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Muat ulang bagian ini
          </button>
        </div>
      );
    }
    return <Fragment key={this.state.remountKey}>{this.props.children}</Fragment>;
  }
}

export default DomRaceBoundary;