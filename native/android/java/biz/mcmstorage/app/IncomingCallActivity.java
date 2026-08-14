package biz.mcmstorage.app;

import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.util.concurrent.Executors;

/**
 * Layar panggilan masuk full-screen (juga di atas lock screen).
 *
 * Dibangun secara programatik supaya tidak bergantung pada layout XML yang
 * bisa hilang saat proyek Android di-generate ulang oleh Capacitor.
 */
public class IncomingCallActivity extends AppCompatActivity {

    private String callId;
    private String conversationId;
    private String declineToken;
    private int notifId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();

        Intent i = getIntent();
        callId = str(i.getStringExtra(AceNotify.EX_CALL_ID));
        conversationId = str(i.getStringExtra(AceNotify.EX_CONVERSATION));
        declineToken = str(i.getStringExtra(AceNotify.EX_TOKEN));
        notifId = i.getIntExtra(AceNotify.EX_NOTIF_ID, 0);
        String callerName = str(i.getStringExtra(AceNotify.EX_CALLER));
        String callKind = str(i.getStringExtra(AceNotify.EX_CALL_KIND));
        if (callerName.isEmpty()) callerName = "Panggilan masuk";

        // Foreground service hanya hidup selama panggilan berdering/aktif.
        CallForegroundService.start(this, callerName, callKind);

        setContentView(buildView(callerName, callKind));

        if (i.getBooleanExtra("autoAccept", false)) accept();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }

    private View buildView(String callerName, String callKind) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#12100E"));
        root.setPadding(48, 48, 48, 48);

        TextView kind = new TextView(this);
        kind.setText("video".equals(callKind) ? "Panggilan video masuk" : "Panggilan suara masuk");
        kind.setTextColor(Color.parseColor("#D4AF37"));
        kind.setTextSize(16f);
        kind.setGravity(Gravity.CENTER);

        TextView name = new TextView(this);
        name.setText(callerName);
        name.setTextColor(Color.WHITE);
        name.setTextSize(30f);
        name.setGravity(Gravity.CENTER);
        name.setPadding(0, 24, 0, 64);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);

        Button decline = new Button(this);
        decline.setText("Tolak");
        decline.setOnClickListener(v -> decline());

        Button accept = new Button(this);
        accept.setText("Jawab");
        accept.setOnClickListener(v -> accept());

        LinearLayout.LayoutParams lp =
                new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        lp.setMargins(16, 0, 16, 0);
        row.addView(decline, lp);
        row.addView(accept, lp);

        root.addView(kind);
        root.addView(name);
        root.addView(row);
        return root;
    }

    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = getSystemService(KeyguardManager.class);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                            | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }

    private void accept() {
        cancelNotification();
        // Web layer yang memegang WebRTC — buka ruang chat dengan ?call=<id>.
        String path = conversationId.isEmpty()
                ? "/chat"
                : "/chat/" + conversationId + (callId.isEmpty() ? "" : "?call=" + callId);
        Intent open = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(AceMessagingService.deepLink(path))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(open);
        finish();
    }

    private void decline() {
        cancelNotification();
        CallForegroundService.stop(this);
        final Context ctx = getApplicationContext();
        final String token = declineToken;
        if (!token.isEmpty()) {
            Executors.newSingleThreadExecutor()
                    .execute(() -> AceNotify.postAction(ctx, token, "call-decline", null));
        }
        finish();
    }

    private void cancelNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null && notifId != 0) nm.cancel(notifId);
    }

    private static String str(String v) {
        return v == null ? "" : v;
    }
}