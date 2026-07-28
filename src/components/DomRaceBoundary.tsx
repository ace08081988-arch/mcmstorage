import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

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
    renderFallback?: (error: Error, reset: () => void) => ReactNode;
  },
  { error: Error | null; attempt: number; remountKey: number }
> {
  state = { error: null as Error | null, attempt: 0, remountKey: 0 };
  private retryTimer: number | null = null;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  private handleReset = () => {
    this.clearTimer();
    this.setState((prev) => ({
      error: null,
      attempt: 0,
      remountKey: prev.remountKey + 1,
    }));
  };

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
    }
  }

  componentWillUnmount() {
    this.clearTimer();
  }

  render() {
    const { error } = this.state;
    if (error) {
      if (this.props.renderFallback) return this.props.renderFallback(error, this.handleReset);
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