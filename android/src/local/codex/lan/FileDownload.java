package local.codex.lan;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;

final class FileDownload {
    // Public and LAN URLs are aliases only after the connection probe verified the same backend.
    static String appLink(String link, String connected, String requested) {
        try {
            URL active = new URL(connected), url = new URL(active, link);
            if (url.getUserInfo() != null || !(url.getProtocol().equals("http") || url.getProtocol().equals("https"))) return null;
            if (sameOrigin(url, active)) return url.toString();
            if (sameOrigin(url, new URL(requested)) && url.getPath().equals("/api/files/download"))
                return new URL(active, url.getFile()).toString();
        } catch (Exception invalid) {}
        return null;
    }

    static String filename(String link, String disposition) {
        String name = "";
        if (disposition != null) {
            Matcher encoded = Pattern.compile("(?i)(?:^|;)\\s*filename\\*\\s*=\\s*UTF-8'[^']*'([^;]+)").matcher(disposition);
            if (encoded.find()) name = decode(encoded.group(1).trim());
            if (name.isEmpty()) {
                Matcher plain = Pattern.compile("(?i)(?:^|;)\\s*filename\\s*=\\s*(?:\"([^\"]*)\"|([^;]*))").matcher(disposition);
                if (plain.find()) name = plain.group(1) != null ? plain.group(1) : plain.group(2).trim();
            }
        }
        if (name.isEmpty()) {
            try { String path = new URL(link).getPath(); name = decode(path.substring(path.lastIndexOf('/') + 1)); }
            catch (Exception ignored) {}
        }
        name = name.replaceAll("[\\\\/\\p{Cntrl}]", "_").trim();
        return name.isEmpty() || name.equals(".") || name.equals("..") ? "download" : name;
    }

    private static String decode(String value) {
        try { return URLDecoder.decode(value.replace("+", "%2B"), "UTF-8"); }
        catch (Exception ignored) { return ""; }
    }

    static boolean sameOrigin(URL a, URL b) {
        return a.getProtocol().equalsIgnoreCase(b.getProtocol()) && a.getHost().equalsIgnoreCase(b.getHost())
                && (a.getPort() < 0 ? a.getDefaultPort() : a.getPort()) == (b.getPort() < 0 ? b.getDefaultPort() : b.getPort());
    }

    static void copy(String link, String server, String username, String password, String cookie,
                     String agent, String proxyAddress, OutputStream output) throws Exception {
        URL initial = new URL(link), trusted = new URL(server), target = initial;
        Proxy proxy = Proxy.NO_PROXY;
        if (!proxyAddress.isEmpty()) {
            URL address = new URL(proxyAddress);
            proxy = new Proxy(Proxy.Type.HTTP, new InetSocketAddress(address.getHost(), address.getPort()));
        }
        for (int redirects = 0; redirects <= 5; redirects++) {
            if (!(target.getProtocol().equals("http") || target.getProtocol().equals("https")) || target.getUserInfo() != null)
                throw new IOException("不支持此下载地址");
            boolean ownServer = sameOrigin(target, trusted);
            HttpURLConnection connection = (HttpURLConnection) target.openConnection(ownServer ? Proxy.NO_PROXY : proxy);
            try {
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(20000);
                connection.setReadTimeout(60000);
                connection.setRequestProperty("Accept-Encoding", "identity");
                if (agent != null) connection.setRequestProperty("User-Agent", agent);
                if (cookie != null && sameOrigin(target, initial)) connection.setRequestProperty("Cookie", cookie);
                if (ownServer) {
                    if (!password.isEmpty()) connection.setRequestProperty("Authorization", "Basic " + Base64.getEncoder()
                            .encodeToString((username + ":" + password).getBytes(StandardCharsets.UTF_8)));
                    if (connection instanceof HttpsURLConnection) {
                        HttpsURLConnection secure = (HttpsURLConnection) connection;
                        secure.setSSLSocketFactory(ProxyTunnel.trustedServerTls().getSocketFactory());
                        secure.setHostnameVerifier((host, session) -> host.equalsIgnoreCase(trusted.getHost()));
                    }
                }
                int status = connection.getResponseCode();
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String location = connection.getHeaderField("Location");
                    if (location == null) throw new IOException("下载跳转缺少地址");
                    target = new URL(target, location);
                    continue;
                }
                if (status != 200) throw new IOException("下载失败：HTTP " + status);
                long expected = connection.getContentLengthLong(), copied = 0;
                try (InputStream input = connection.getInputStream()) {
                    byte[] buffer = new byte[32768];
                    for (int size; (size = input.read(buffer)) != -1;) { output.write(buffer, 0, size); copied += size; }
                }
                if (expected >= 0 && copied != expected) throw new IOException("文件未下载完整，请重试");
                return;
            } finally { connection.disconnect(); }
        }
        throw new IOException("下载跳转次数过多");
    }
}
