package local.codex.lan;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.WebView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.net.URI;
import java.util.Collections;
import java.util.UUID;
import org.json.JSONObject;

/** Device-local UI state shared by the verified public and LAN addresses. */
final class WorkspaceResume {
    private final SharedPreferences preferences;
    private final String profile;
    private WebView activeWeb;

    void selectProduct(String product) {
        if (!product.equals("codex") && !product.equals("claude") && !product.equals("zcode"))
            throw new IllegalArgumentException("Unknown harness");
        activeWeb = null;
        JSONObject saved;
        try { saved = new JSONObject(preferences.getString("state:" + profile, "{}")); }
        catch (org.json.JSONException invalid) { saved = new JSONObject(); }
        try { saved.put("codex-webui-last-product", product); }
        catch (org.json.JSONException impossible) { throw new IllegalStateException(impossible); }
        preferences.edit().putString("state:" + profile, saved.toString()).apply();
    }

    static String origin(String url) {
        URI uri = URI.create(url);
        int port = uri.getPort();
        boolean standard = port == -1 || (port == 80 && "http".equals(uri.getScheme())) || (port == 443 && "https".equals(uri.getScheme()));
        return uri.getScheme() + "://" + uri.getHost() + (standard ? "" : ":" + port);
    }

    WorkspaceResume(Context context, String requested, LanConnection.Selection selected) {
        preferences = context.getSharedPreferences("workspace-resume", Context.MODE_PRIVATE);
        String requestedKey = "origin:" + origin(requested), selectedKey = "origin:" + origin(selected.url);
        String identityKey = "server:" + selected.serverId;
        String known = preferences.getString(requestedKey, null);
        if (known == null && !selected.serverId.isEmpty()) known = preferences.getString(identityKey, null);
        if (known == null) known = preferences.getString(selectedKey, null);
        profile = known == null ? UUID.randomUUID().toString() : known;
        SharedPreferences.Editor editor = preferences.edit().putString(requestedKey, profile).putString(selectedKey, profile);
        if (!selected.serverId.isEmpty()) editor.putString(identityKey, profile);
        editor.apply();
    }

    private static boolean allowed(String key) {
        return key.matches("codex-webui-zcode-view:[A-Za-z0-9_-]{1,200}") ||
            key.matches("(?:codex-webui-(?:last-product|active-thread|project|expanded-project|workspace-view|zcode-layout|zcode-panels)|claude-(?:workspace-view|workspace-scroll|artifact-layout))");
    }

    void install(Context context, WebView web, String url) {
        activeWeb = web;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        String sourceOrigin = origin(url);
        WebViewCompat.addWebMessageListener(web, "CodexWorkspaceState", Collections.singleton(sourceOrigin), (view, message, source, main, reply) -> {
            if (view != activeWeb || !sourceOrigin.equals(origin(source.toString()))) return;
            try {
                String body = message.getData();
                if (body == null || body.length() > 270000) return;
                JSONObject update = new JSONObject(body);
                String key = update.getString("key");
                if (!allowed(key) || !(update.isNull("value") || update.get("value") instanceof String)) return;
                JSONObject saved = new JSONObject(preferences.getString("state:" + profile, "{}"));
                saved.put(key, update.get("value"));
                if (saved.toString().length() <= 1048576) preferences.edit().putString("state:" + profile, saved.toString()).apply();
            } catch (Exception ignored) { /* Ignore malformed messages, keep the last valid snapshot. */ }
        });
        try (java.io.InputStream input = context.getAssets().open("workspace-resume.js")) {
            java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            for (int size; (size = input.read(buffer)) != -1;) output.write(buffer, 0, size);
            String script = new String(output.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
            String state = preferences.getString("state:" + profile, "{}");
            WebViewCompat.addDocumentStartJavaScript(web, "(" + script + ")(" + state + "," + JSONObject.quote(UUID.randomUUID().toString()) + ");", Collections.singleton(sourceOrigin));
        } catch (Exception error) { android.util.Log.e("WorkspaceResume", "Unable to load UI restoration script", error); }
    }
}
