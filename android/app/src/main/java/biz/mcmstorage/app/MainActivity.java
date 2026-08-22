package biz.mcmstorage.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Aktivitas utama MCM Storage.
 *
 * Layar penuh edge-to-edge: WebView menggambar sampai tepi layar (termasuk
 * area poni / gesture bar), lalu inset aslinya dikembalikan ke CSS lewat
 * `env(safe-area-inset-*)` — dipakai oleh `src/lib/safe-area-recalc.ts`.
 * Tanpa ini, HP berponi menampilkan pita hitam di atas header.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Konten menggambar di belakang status bar & navigation bar.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        // Izinkan konten masuk ke area poni juga saat perangkat dirotasi.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
    }
}
