package local.codex.lan;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.text.InputType;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.webkit.HttpAuthHandler;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String DEFAULT_URL = "";
    private static final String PREFS = "connection";
    private static final String PREF_URL = "server_url";
    private static final String PREF_PASSWORD = "server_password";
    private static final String PREF_HISTORY = "connection_history";
    private static final String AUTH_USERNAME = "codex";
    private static final int PICK_FILES = 1;
    private static final int SAVE_FILE = 2;
    private FrameLayout root;
    private WebView web;
    private WebView browserWeb;
    private String serverPassword = "";
    private String connectedHost = "";
    private String connectedUrl = "";
    private String requestedUrl = "";
    private String requestedPassword = "";
    private String proxyUrl = "";
    private ProxyTunnel proxyTunnel;
    private boolean browserLoadFailed;
    private boolean proxyEnabled;
    private boolean browserRequested;
    private ValueCallback<Uri[]> pendingFiles;
    private java.util.function.Consumer<Uri> pendingSave;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    private boolean connectionProbeRunning;
    private int connectionGeneration;
    private WorkspaceResume workspaceResume;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root);
        connectivity = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network network) { runOnUiThread(() -> refreshPreferredConnection(null)); }
        };
        connectivity.registerDefaultNetworkCallback(networkCallback);
        showAddress();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void applySystemTheme(boolean dark, int color) {
        // Android 15 draws transparent system bars over this inset background.
        root.setBackgroundColor(color);
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            int mask = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            getWindow().getInsetsController().setSystemBarsAppearance(dark ? 0 : mask, mask);
        } else {
            View decor = getWindow().getDecorView();
            int mask = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            decor.setSystemUiVisibility((decor.getSystemUiVisibility() & ~mask) | (dark ? 0 : mask));
        }
    }

    private void destroyWebViews() {
        connectionGeneration++;
        connectionProbeRunning = false;
        browserRequested = false;
        disableProxy();
        if (proxyTunnel != null) { proxyTunnel.close(); proxyTunnel = null; }
        if (browserWeb != null) { root.removeView(browserWeb); browserWeb.destroy(); browserWeb = null; }
        if (web != null) { root.removeView(web); web.destroy(); web = null; }
    }

    private void showAddress() {
        applySystemTheme(false, Color.WHITE);
        if (pendingFiles != null) { pendingFiles.onReceiveValue(null); pendingFiles = null; }
        destroyWebViews();
        root.removeAllViews();
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setGravity(Gravity.CENTER_VERTICAL);
        form.setPadding(dp(28), dp(28), dp(28), dp(28));
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(form, new ScrollView.LayoutParams(-1, -2));
        root.addView(scroll, new FrameLayout.LayoutParams(-1, -1));
        TextView title = new TextView(this);
        title.setText("Codex 局域网"); title.setTextColor(Color.BLACK); title.setTextSize(28);
        form.addView(title);
        TextView help = new TextView(this);
        help.setText("输入网页地址；公网 HTTPS 可填写访问密码。\n点历史连接直接打开，点 ☆ 保存。长按可编辑或删除。\n进入网页后，系统返回键／返回手势可打开隐藏导航。\n地址和密码只保存在本机。");
        help.setTextSize(15); help.setPadding(0, dp(12), 0, dp(24)); form.addView(help);
        android.content.SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        String savedUrl = preferences.getString(PREF_URL, DEFAULT_URL);
        ConnectionHistory history = ConnectionHistory.load(preferences.getString(PREF_HISTORY, ""),
                preferences.contains(PREF_URL) && !preferences.contains(PREF_HISTORY) ? savedUrl : null,
                preferences.getString(PREF_PASSWORD, ""));
        saveConnectionHistory(history);
        EditText address = new EditText(this);
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setText(savedUrl);
        address.setSelection(address.getText().length());
        address.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        address.setSaveEnabled(false); form.addView(address);
        EditText password = new EditText(this);
        password.setSingleLine(true);
        password.setHint("访问密码（可选）");
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        ConnectionHistory.Entry last = history.find(savedUrl);
        password.setText(last == null ? "" : last.password);
        password.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        password.setSaveEnabled(false); form.addView(password);
        address.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence text, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence text, int start, int before, int count) { }
            @Override public void afterTextChanged(Editable text) {
                ConnectionHistory.Entry entry = history.find(text.toString());
                password.setText(entry == null ? "" : entry.password);
            }
        });
        LinearLayout actions = new LinearLayout(this);
        Button save = new Button(this); save.setText("保存连接");
        Button connect = new Button(this); connect.setText("连接");
        actions.addView(save, new LinearLayout.LayoutParams(0, -2, 1));
        actions.addView(connect, new LinearLayout.LayoutParams(0, -2, 1));
        form.addView(actions);
        LinearLayout connections = new LinearLayout(this);
        connections.setOrientation(LinearLayout.VERTICAL);
        form.addView(connections);
        save.setOnClickListener(v -> {
            if (connectionProbeRunning) return;
            try {
                history.put(address.getText().toString(), password.getText().toString(), true);
                saveConnectionHistory(history);
                renderConnections(connections, history, address, password, connect);
                Toast.makeText(this, "连接已保存", Toast.LENGTH_SHORT).show();
            } catch (IllegalArgumentException error) { address.setError(error.getMessage()); }
        });
        connect.setOnClickListener(v -> {
            if (connectionProbeRunning) return;
            try {
                String url = ServerAddress.normalize(address.getText().toString());
                requestedUrl = url;
                requestedPassword = password.getText().toString();
                ConnectionHistory.Entry entry = history.find(url);
                history.put(url, requestedPassword, entry != null && entry.saved);
                saveConnectionHistory(history);
                preferences.edit().putString(PREF_URL, url).apply();
                ((InputMethodManager)getSystemService(INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(address.getWindowToken(), 0);
                address.setEnabled(false); password.setEnabled(false); save.setEnabled(false);
                connect.setEnabled(false);
                connect.setText("正在连接…");
                probePreferred(url, requestedPassword, selected -> {
                    address.setEnabled(true); password.setEnabled(true); save.setEnabled(true);
                    connect.setEnabled(true); connect.setText("连接");
                    applySelection(selected, true);
                });
            } catch (IllegalArgumentException error) { address.setError(error.getMessage()); }
        });
        address.setOnEditorActionListener((view, action, event) -> { connect.performClick(); return true; });
        password.setOnEditorActionListener((view, action, event) -> { connect.performClick(); return true; });
        renderConnections(connections, history, address, password, connect);
    }

    private void saveConnectionHistory(ConnectionHistory history) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_HISTORY, history.encode()).remove(PREF_PASSWORD).apply();
    }

    private void renderConnections(LinearLayout list, ConnectionHistory history, EditText address, EditText password, Button connect) {
        list.removeAllViews();
        for (boolean saved : new boolean[]{true, false}) {
            boolean headingAdded = false;
            for (ConnectionHistory.Entry entry : history.entries) {
                if (entry.saved != saved) continue;
                if (!headingAdded) {
                    TextView heading = new TextView(this);
                    heading.setText(saved ? "已保存" : "最近连接");
                    heading.setTextSize(14); heading.setTextColor(Color.DKGRAY);
                    heading.setPadding(0, dp(20), 0, dp(4)); list.addView(heading);
                    headingAdded = true;
                }
                LinearLayout row = new LinearLayout(this);
                Button open = new Button(this, null, android.R.attr.borderlessButtonStyle);
                open.setText(entry.url); open.setAllCaps(false); open.setTextSize(14);
                open.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
                open.setMaxLines(2); open.setEllipsize(android.text.TextUtils.TruncateAt.MIDDLE);
                row.addView(open, new LinearLayout.LayoutParams(0, dp(56), 1));
                Button pin = new Button(this, null, android.R.attr.borderlessButtonStyle);
                pin.setText(saved ? "★" : "☆"); pin.setTextSize(22);
                pin.setPadding(0, 0, 0, 0); pin.setMinWidth(0); pin.setMinimumWidth(0);
                pin.setContentDescription((saved ? "取消保存：" : "保存连接：") + entry.url);
                row.addView(pin, new LinearLayout.LayoutParams(dp(48), dp(56)));
                list.addView(row);
                open.setOnClickListener(v -> {
                    if (connectionProbeRunning) return;
                    address.setText(entry.url); password.setText(entry.password); connect.performClick();
                });
                pin.setOnClickListener(v -> {
                    if (connectionProbeRunning) return;
                    history.put(entry.url, entry.password, !entry.saved);
                    saveConnectionHistory(history);
                    renderConnections(list, history, address, password, connect);
                });
                open.setOnLongClickListener(v -> {
                    if (connectionProbeRunning) return true;
                    new AlertDialog.Builder(this).setTitle(entry.url)
                            .setItems(new String[]{"编辑连接", "删除连接"}, (dialog, which) -> {
                                if (which == 0) {
                                    address.setText(entry.url); password.setText(entry.password); address.requestFocus();
                                } else {
                                    if (history.find(address.getText().toString()) == entry) password.setText("");
                                    android.content.SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
                                    if (history.find(prefs.getString(PREF_URL, "")) == entry) prefs.edit().remove(PREF_URL).apply();
                                    history.remove(entry.url); saveConnectionHistory(history);
                                    renderConnections(list, history, address, password, connect);
                                }
                            }).show();
                    return true;
                });
            }
        }
    }

    private void probePreferred(String url, String password, java.util.function.Consumer<LanConnection.Selection> ready) {
        if (connectionProbeRunning) return;
        connectionProbeRunning = true;
        int generation = connectionGeneration;
        new Thread(() -> {
            LanConnection.Selection selected = LanConnection.prefer(url, AUTH_USERNAME, password);
            runOnUiThread(() -> {
                if (generation != connectionGeneration) return;
                connectionProbeRunning = false;
                if (!isFinishing() && !isDestroyed()) ready.accept(selected);
            });
        }, "connection-probe").start();
    }

    private void applySelection(LanConnection.Selection selected, boolean notify) {
        workspaceResume = new WorkspaceResume(this, requestedUrl, selected);
        boolean lan = false;
        try { lan = LanConnection.isLan(new java.net.URL(selected.url)); } catch (Exception ignored) {}
        serverPassword = lan ? "" : requestedPassword;
        if (notify && lan && !selected.url.equals(requestedUrl))
            Toast.makeText(this, "已自动使用局域网连接", Toast.LENGTH_SHORT).show();
        configureProxy(selected.url);
    }

    private void refreshPreferredConnection(String failure) {
        if (web == null || requestedUrl.isEmpty() || connectionProbeRunning) return;
        String before = connectedUrl;
        probePreferred(requestedUrl, requestedPassword, selected -> {
            if (!selected.url.equals(before) && selected.publicReachable) {
                destroyWebViews();
                applySelection(selected, true);
            } else if (failure != null) {
                new AlertDialog.Builder(MainActivity.this).setTitle("连接失败")
                        .setMessage("局域网和公网入口均不可用。\n" + failure)
                        .setPositiveButton("重试", (dialog, which) -> refreshPreferredConnection(failure))
                        .setNegativeButton("修改地址", (dialog, which) -> showAddress()).show();
            }
        });
    }

    private void configureProxy(String url) {
        Uri server = Uri.parse(url);
        connectedHost = server.getHost();
        connectedUrl = url;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
            Toast.makeText(this, "当前 Android WebView 不支持代理，请更新系统 WebView", Toast.LENGTH_LONG).show();
            return;
        }
        try {
            proxyTunnel = new ProxyTunnel(url, AUTH_USERNAME, serverPassword,
                    error -> runOnUiThread(() -> reportBrowserState("", "error", error)));
            proxyUrl = proxyTunnel.proxyUrl();
        } catch (java.io.IOException error) {
            Toast.makeText(this, "无法启动浏览器代理：" + error.getMessage(), Toast.LENGTH_LONG).show();
            return;
        }
        showWeb(url);
    }

    private void enableProxy(Runnable ready) {
        if (proxyEnabled) { ready.run(); return; }
        ProxyConfig config = new ProxyConfig.Builder()
                .addProxyRule(proxyUrl)
                .addBypassRule(connectedHost)
                .removeImplicitRules()
                .build();
        ProxyController.getInstance().setProxyOverride(config, command -> runOnUiThread(command), () -> {
            proxyEnabled = true;
            if (browserRequested) ready.run(); else disableProxy();
        });
    }

    private void disableProxy() {
        if (!proxyEnabled) return;
        proxyEnabled = false;
        ProxyController.getInstance().clearProxyOverride(command -> runOnUiThread(command), () -> {});
    }

    private WebChromeClient chromeClient(ProgressBar progress) {
        return new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                if (progress == null) return;
                progress.setProgress(value); progress.setVisibility(value == 100 ? View.GONE : View.VISIBLE);
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                Intent picker = params.createIntent();
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(picker, PICK_FILES); }
                catch (ActivityNotFoundException error) {
                    pendingFiles.onReceiveValue(null); pendingFiles = null;
                    Toast.makeText(MainActivity.this, "系统没有可用的文件选择器", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        };
    }

    private void showWeb(String url) {
        root.removeAllViews();
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        web.addJavascriptInterface(new BrowserBridge(), "CodexBrowser");
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        ProgressBar progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new FrameLayout.LayoutParams(-1, dp(2), Gravity.TOP));
        web.setWebChromeClient(chromeClient(progress));
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                return !"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme);
            }
            @Override public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
                if (!serverPassword.isEmpty() && connectedHost.equalsIgnoreCase(host)) { handler.proceed(AUTH_USERNAME, serverPassword); return; }
                handler.cancel();
                Toast.makeText(MainActivity.this, "请在连接页填写访问密码", Toast.LENGTH_LONG).show();
                showAddress();
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                String host = Uri.parse(error.getUrl()).getHost();
                if (host != null && connectedHost.equalsIgnoreCase(host)) handler.proceed(); else handler.cancel();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame() || isFinishing()) return;
                refreshPreferredConnection(error.getDescription().toString());
            }
        });
        web.setDownloadListener(downloadListener(false));
        workspaceResume.install(this, web, url);
        web.loadUrl(url);
    }

    private DownloadListener downloadListener(boolean browser) {
        return (link, agent, disposition, mime, length) -> {
            String scheme = Uri.parse(link).getScheme();
            if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
                Toast.makeText(this, "此下载不是可保存的文件链接", Toast.LENGTH_LONG).show();
                return;
            }
            String name = FileDownload.filename(link, disposition);
            String type = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
            String cookie = CookieManager.getInstance().getCookie(link);
            String server = connectedUrl, password = serverPassword, proxy = browser ? proxyUrl : "";
            java.util.function.Consumer<Uri> save = destination -> {
                Toast.makeText(this, "正在保存：" + name, Toast.LENGTH_SHORT).show();
                new Thread(() -> {
                    try {
                        try (java.io.OutputStream output = getContentResolver().openOutputStream(destination, "w")) {
                            if (output == null) throw new java.io.IOException("无法创建文件");
                            FileDownload.copy(link, server, AUTH_USERNAME, password, cookie, agent, proxy, output);
                        }
                        if (Build.VERSION.SDK_INT >= 29) {
                            ContentValues ready = new ContentValues();
                            ready.put(MediaStore.Downloads.IS_PENDING, 0);
                            getContentResolver().update(destination, ready, null, null);
                        }
                        runOnUiThread(() -> Toast.makeText(this, "已保存" + (Build.VERSION.SDK_INT >= 29 ? "到下载目录：" : "：") + name, Toast.LENGTH_LONG).show());
                    } catch (Exception error) {
                        try {
                            if (Build.VERSION.SDK_INT >= 29) getContentResolver().delete(destination, null, null);
                            else DocumentsContract.deleteDocument(getContentResolver(), destination);
                        } catch (Exception ignored) {}
                        runOnUiThread(() -> Toast.makeText(this, "保存失败：" + error.getMessage(), Toast.LENGTH_LONG).show());
                    }
                }, "file-download").start();
            };
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    values.put(MediaStore.Downloads.MIME_TYPE, type);
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri destination = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (destination == null) throw new java.io.IOException("无法创建下载文件");
                    save.accept(destination);
                } else {
                    pendingSave = save;
                    startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                            .setType(type).putExtra(Intent.EXTRA_TITLE, name), SAVE_FILE);
                }
            } catch (Exception error) {
                pendingSave = null;
                Toast.makeText(this, "无法保存文件：" + error.getMessage(), Toast.LENGTH_LONG).show();
            }
        };
    }

    private void ensureBrowserWeb() {
        if (browserWeb != null) return;
        browserWeb = new WebView(this);
        browserWeb.setBackgroundColor(Color.WHITE);
        WebSettings settings = browserWeb.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        browserWeb.setWebChromeClient(chromeClient(null));
        browserWeb.setDownloadListener(downloadListener(true));
        browserWeb.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                return !"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme);
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) { browserLoadFailed = false; reportBrowserState(url, "loading", ""); }
            @Override public void onPageFinished(WebView view, String url) { if (!browserLoadFailed) reportBrowserState(url, "loaded", ""); }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) reportBrowserState(request.getUrl().toString(), "error", "HTTP " + response.getStatusCode());
            }
            @Override public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
                if (!serverPassword.isEmpty() && connectedHost.equalsIgnoreCase(host)) handler.proceed(AUTH_USERNAME, serverPassword); else handler.cancel();
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                String host = Uri.parse(error.getUrl()).getHost();
                if (host != null && connectedHost.equalsIgnoreCase(host)) handler.proceed();
                else { handler.cancel(); reportBrowserState(error.getUrl(), "error", "TLS certificate validation failed"); }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) reportBrowserState(request.getUrl().toString(), "error", error.getDescription().toString());
            }
        });
        browserWeb.setVisibility(View.GONE);
        root.addView(browserWeb, new FrameLayout.LayoutParams(1, 1));
    }

    private void placeBrowser(int left, int top, int width, int height) {
        ensureBrowserWeb();
        FrameLayout.LayoutParams layout = new FrameLayout.LayoutParams(Math.max(1, width), Math.max(1, height));
        // FrameLayout already adds its system-inset padding to child margins.
        layout.leftMargin = web.getLeft() - root.getPaddingLeft() + left;
        layout.topMargin = web.getTop() - root.getPaddingTop() + top;
        browserWeb.setLayoutParams(layout);
        browserWeb.bringToFront();
    }

    private void reportBrowserState(String url, String status, String error) {
        if (web == null) return;
        if ("error".equals(status)) browserLoadFailed = true;
        String script = "window.__codexNativeBrowserState&&window.__codexNativeBrowserState(" + JSONObject.quote(url == null ? "" : url)
                + "," + (browserWeb != null && browserWeb.canGoBack()) + "," + (browserWeb != null && browserWeb.canGoForward())
                + "," + JSONObject.quote(status) + "," + JSONObject.quote(error) + ")";
        web.evaluateJavascript(script, null);
    }

    private final class BrowserBridge {
        @JavascriptInterface public void setTheme(boolean dark, String background) {
            if (background == null || !background.matches("#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?")) return;
            String hex = background.length() == 4 ? "#" + background.charAt(1) + background.charAt(1)
                    + background.charAt(2) + background.charAt(2) + background.charAt(3) + background.charAt(3) : background;
            int color = Color.parseColor(hex);
            runOnUiThread(() -> { if (web != null && !isFinishing()) applySystemTheme(dark, color); });
        }

        @JavascriptInterface public boolean download(String link, String filename) {
            String resolved = FileDownload.appLink(link, connectedUrl, requestedUrl);
            if (resolved == null) return false;
            String disposition = "";
            try {
                if (filename != null && !filename.isEmpty()) disposition = "attachment; filename*=UTF-8''"
                        + java.net.URLEncoder.encode(filename, "UTF-8").replace("+", "%20");
            } catch (java.io.UnsupportedEncodingException impossible) { return false; }
            final String title = disposition;
            runOnUiThread(() -> {
                if (web != null && !isFinishing()) downloadListener(false).onDownloadStart(resolved,
                        web.getSettings().getUserAgentString(), title, "application/octet-stream", -1);
            });
            return true;
        }

        @JavascriptInterface public void resize(int left, int top, int width, int height) {
            runOnUiThread(() -> placeBrowser(left, top, width, height));
        }
        @JavascriptInterface public void show(String url) {
            runOnUiThread(() -> {
                browserRequested = true;
                enableProxy(() -> {
                    ensureBrowserWeb();
                    browserWeb.setVisibility(View.VISIBLE);
                    if (!url.equals(browserWeb.getUrl())) browserWeb.loadUrl(url); else reportBrowserState(url, "loaded", "");
                });
            });
        }
        @JavascriptInterface public void hide() { runOnUiThread(() -> { browserRequested = false; if (browserWeb != null) browserWeb.setVisibility(View.GONE); disableProxy(); }); }
        @JavascriptInterface public void back() { runOnUiThread(() -> { if (browserWeb != null && browserWeb.canGoBack()) browserWeb.goBack(); }); }
        @JavascriptInterface public void forward() { runOnUiThread(() -> { if (browserWeb != null && browserWeb.canGoForward()) browserWeb.goForward(); }); }
        @JavascriptInterface public void reload() { runOnUiThread(() -> { if (browserWeb != null) browserWeb.reload(); }); }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILES && pendingFiles != null) {
            pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            pendingFiles = null;
        }
        if (request == SAVE_FILE && pendingSave != null) {
            java.util.function.Consumer<Uri> save = pendingSave;
            pendingSave = null;
            if (result == RESULT_OK && data != null && data.getData() != null) save.accept(data.getData());
        }
    }

    private void navigateHarness(String product, String path) {
        String destination = WorkspaceResume.origin(connectedUrl) + path;
        destroyWebViews();
        workspaceResume.selectProduct(product);
        // Keep public/LAN fallback on the explicitly selected harness as well.
        requestedUrl = WorkspaceResume.origin(requestedUrl) + path;
        configureProxy(destination);
    }

    @Override public void onBackPressed() {
        if (web == null) { finishAndRemoveTask(); return; }
        WebView page = browserWeb != null && browserWeb.getVisibility() == View.VISIBLE ? browserWeb : web;
        new AlertDialog.Builder(this).setTitle("导航")
                .setItems(new String[]{"Codex", "Claude Code", "ZCode", "网页后退", "网页前进", "刷新网页", "连接管理", "退出应用"}, (dialog, which) -> {
                    switch (which) {
                        case 0: navigateHarness("codex", "/"); break;
                        case 1: navigateHarness("claude", "/claude/app/"); break;
                        case 2: navigateHarness("zcode", "/zcode"); break;
                        case 3:
                            if (page.canGoBack()) page.goBack();
                            else Toast.makeText(this, "没有上一页", Toast.LENGTH_SHORT).show();
                            break;
                        case 4:
                            if (page.canGoForward()) page.goForward();
                            else Toast.makeText(this, "没有下一页", Toast.LENGTH_SHORT).show();
                            break;
                        case 5: page.reload(); break;
                        case 6: showAddress(); break;
                        case 7: finishAndRemoveTask(); break;
                    }
                }).setNegativeButton("取消", null).show();
    }

    @Override protected void onResume() {
        super.onResume();
        refreshPreferredConnection(null);
    }

    @Override protected void onPause() {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('workspace-save'));for(const frame of document.querySelectorAll('iframe')){try{frame.contentWindow.dispatchEvent(new Event('workspace-save'))}catch{}}", null);
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override protected void onDestroy() {
        if (pendingFiles != null) { pendingFiles.onReceiveValue(null); pendingFiles = null; }
        destroyWebViews();
        disableProxy();
        if (connectivity != null && networkCallback != null) {
            try { connectivity.unregisterNetworkCallback(networkCallback); } catch (IllegalArgumentException ignored) {}
        }
        super.onDestroy();
    }
}
