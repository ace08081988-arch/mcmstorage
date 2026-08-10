# ─────────────────────────────────────────────────────────────────────
# Ace Storage — aturan R8/ProGuard untuk release (minifyEnabled true).
# ─────────────────────────────────────────────────────────────────────

# Simpan nomor baris supaya stacktrace Play Console bisa di-deobfuscate
# dengan mapping.txt (diarsipkan otomatis oleh scripts/preflight-release.mjs).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
-keepattributes *Annotation*, Signature, Exceptions, InnerClasses, EnclosingMethod

# ── Capacitor core + bridge ──────────────────────────────────────────
# Bridge memanggil plugin lewat refleksi: nama class & method wajib utuh.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep class com.getcapacitor.plugin.** { *; }

# Cordova plugin bridge (capacitor-cordova-android-plugins).
-keep class org.apache.cordova.** { *; }
-keep public class * extends org.apache.cordova.CordovaPlugin

# ── Plugin resmi/komunitas yang dipakai app ini ──────────────────────
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.getcapacitor.community.** { *; }
-keep class io.aparajita.capacitor.** { *; }
-keep class ee.forgr.** { *; }

# ── WebView JavaScript interface ─────────────────────────────────────
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepclassmembers class * extends android.webkit.WebChromeClient {
    public void openFileChooser(...);
}

# ── AndroidX / Firebase (push) ───────────────────────────────────────
-keep class androidx.core.app.CoreComponentFactory { *; }
-dontwarn com.google.firebase.**
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# ── JSON reflection (org.json dipakai bridge Capacitor) ──────────────
-keepclassmembers class * {
    public <init>(org.json.JSONObject);
}

# ── Enum + Parcelable (dipakai lintas bridge) ────────────────────────
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}

# Kurangi noise build.
-dontwarn org.slf4j.**
-dontwarn javax.annotation.**
