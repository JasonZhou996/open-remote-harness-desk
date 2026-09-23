package local.codex.lan;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.StringReader;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Properties;
import javax.net.ssl.HttpsURLConnection;

final class LanConnection {
    static final class Selection {
        final String url;
        final boolean publicReachable;
        final String serverId;

        Selection(String url, boolean publicReachable) {
            this(url, publicReachable, "");
        }

        Selection(String url, boolean publicReachable, String serverId) {
            this.url = url;
            this.publicReachable = publicReachable;
            this.serverId = serverId == null ? "" : serverId;
        }
    }

    static boolean isLan(URL url) {
        String[] parts = url.getHost().split("\\.");
        if (parts.length != 4) return false;
        int[] ip = new int[4];
        try {
            for (int i = 0; i < 4; i++) {
                if (!parts[i].matches("[0-9]{1,3}")) return false;
                ip[i] = Integer.parseInt(parts[i]);
                if (ip[i] > 255) return false;
            }
        } catch (NumberFormatException invalid) { return false; }
        return ip[0] == 10 || (ip[0] == 192 && ip[1] == 168) || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31);
    }

    static Selection prefer(String requested, String username, String password) {
        HttpURLConnection remote = null;
        try {
            URL original = new URL(requested);
            if (isLan(original)) {
                String id = verifyLan(original, null);
                return new Selection(requested, id != null, id);
            }
            remote = publicProbe(original, "/api/lan-discovery", username, password);
            int code = remote.getResponseCode();
            boolean legacy = code == 404;
            if (legacy) {
                remote.disconnect();
                remote = publicProbe(original, "/api/auth/status", username, password);
                code = remote.getResponseCode();
            }
            if (code != 200) return new Selection(requested, false);
            String id, address;
            if (legacy) {
                id = remote.getHeaderField("x-codex-server-id");
                address = remote.getHeaderField("x-codex-lan-url");
            } else {
                Properties cached = new Properties();
                try (InputStream input = remote.getInputStream()) {
                    ByteArrayOutputStream body = new ByteArrayOutputStream();
                    byte[] buffer = new byte[512];
                    for (int size; (size = input.read(buffer)) != -1;) {
                        if (body.size() + size > 4096) return new Selection(requested, true);
                        body.write(buffer, 0, size);
                    }
                    cached.load(new StringReader(new String(body.toByteArray(), StandardCharsets.UTF_8)));
                }
                id = cached.getProperty("serverId");
                address = cached.getProperty("lanUrl");
            }
            if (id == null || id.isEmpty() || address == null) return new Selection(requested, true, id);
            URL lan = new URL(ServerAddress.normalize(address));
            if (!isLan(lan) || !id.equals(verifyLan(lan, id))) return new Selection(requested, true, id);
            return new Selection(withPath(lan, original), true, id);
        } catch (Exception unavailable) { return new Selection(requested, false); }
        finally { if (remote != null) remote.disconnect(); }
    }

    private static HttpURLConnection publicProbe(URL server, String path, String username, String password) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(server, path).openConnection(Proxy.NO_PROXY);
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(5000); connection.setReadTimeout(5000);
        if (!password.isEmpty()) connection.setRequestProperty("Authorization", "Basic " + Base64.getEncoder()
                .encodeToString((username + ":" + password).getBytes(StandardCharsets.UTF_8)));
        if (connection instanceof HttpsURLConnection) {
            HttpsURLConnection secure = (HttpsURLConnection) connection;
            secure.setSSLSocketFactory(ProxyTunnel.trustedServerTls().getSocketFactory());
            secure.setHostnameVerifier((host, session) -> host.equalsIgnoreCase(server.getHost()));
        }
        return connection;
    }

    private static String verifyLan(URL lan, String expectedId) {
        HttpURLConnection status = null, config = null;
        try {
            // Anonymous probes prevent the public password from reaching an unverified LAN device.
            status = probe(lan);
            if (status.getResponseCode() != 200) return null;
            String id = status.getHeaderField("x-codex-server-id");
            if (id == null || id.isEmpty() || (expectedId != null && !expectedId.equals(id))) return null;
            config = (HttpURLConnection) new URL(lan, "/api/config").openConnection(Proxy.NO_PROXY);
            config.setInstanceFollowRedirects(false);
            config.setConnectTimeout(1000); config.setReadTimeout(1000);
            return config.getResponseCode() == 200 ? id : null;
        } catch (Exception unavailable) { return null; }
        finally {
            if (status != null) status.disconnect();
            if (config != null) config.disconnect();
        }
    }

    private static String withPath(URL lan, URL requested) throws Exception {
        return new URL(lan, requested.getFile().isEmpty() ? "/" : requested.getFile()).toString();
    }

    private static HttpURLConnection probe(URL server) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(server, "/api/auth/status").openConnection(Proxy.NO_PROXY);
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(1500); connection.setReadTimeout(1500);
        return connection;
    }
}
