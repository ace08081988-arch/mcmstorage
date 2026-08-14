package biz.mcmstorage.app;

import com.getcapacitor.BridgeActivity;

/**
 * Target activity untuk conversation bubble.
 *
 * Activity terpisah (bukan MainActivity) karena bubble WAJIB memakai
 * activity yang resizeable + documentLaunchMode="always" + embedded —
 * atribut yang tidak boleh dipasang pada launcher singleTask.
 * Isinya tetap WebView Capacitor yang sama, dibuka pada deep link chat.
 */
public class ChatBubbleActivity extends BridgeActivity {}