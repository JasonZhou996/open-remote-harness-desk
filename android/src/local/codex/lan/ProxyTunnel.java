package local.codex.lan;

import java.io.ByteArrayOutputStream;
import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.cert.X509Certificate;
import java.util.Base64;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

// WebView uses a normal loopback HTTP proxy. Only its transport is tunneled
// through the configured server's HTTPS port; target TLS stays end-to-end.
final class ProxyTunnel implements AutoCloseable {
    private final URI server;
    private final String authorization;
    private final Consumer<String> onError;
    private final ServerSocket listener;
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final Set<Socket> sockets = ConcurrentHashMap.newKeySet();
    private volatile boolean closed;

    ProxyTunnel(String address, String username, String password, Consumer<String> onError) throws IOException {
        server = URI.create(address);
        authorization = password.isEmpty() ? "" : "Authorization: Basic " + Base64.getEncoder()
                .encodeToString((username + ":" + password).getBytes(StandardCharsets.UTF_8)) + "\r\n";
        this.onError = onError;
        listener = new ServerSocket(0, 32, InetAddress.getByName("127.0.0.1"));
        workers.execute(() -> {
            while (!closed) {
                try {
                    Socket client = listener.accept();
                    sockets.add(client);
                    workers.execute(() -> relay(client));
                } catch (IOException error) {
                    if (!closed) onError.accept(error.getMessage());
                }
            }
        });
    }

    String proxyUrl() { return "http://127.0.0.1:" + listener.getLocalPort(); }

    private Socket connect() throws IOException, GeneralSecurityException {
        boolean tls = "https".equalsIgnoreCase(server.getScheme());
        int port = server.getPort() >= 0 ? server.getPort() : tls ? 443 : 80;
        Socket raw = new Socket();
        Socket upstream = raw;
        sockets.add(raw);
        try {
            raw.connect(new InetSocketAddress(server.getHost(), port), 15000);
            if (tls) {
                SSLContext context = trustedServerTls();
                SSLSocket secure = (SSLSocket) context.getSocketFactory().createSocket(raw, server.getHost(), port, true);
                sockets.add(secure);
                sockets.remove(raw);
                upstream = secure;
            }
            upstream.setSoTimeout(20000);
            if (upstream instanceof SSLSocket) ((SSLSocket) upstream).startHandshake();
            return upstream;
        } catch (IOException | GeneralSecurityException error) {
            closeSocket(upstream);
            throw error;
        }
    }

    // Only for the server explicitly trusted on the connection screen, never other websites.
    static SSLContext trustedServerTls() throws GeneralSecurityException {
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, new TrustManager[]{new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            public void checkClientTrusted(X509Certificate[] chain, String authType) {}
            public void checkServerTrusted(X509Certificate[] chain, String authType) {}
        }}, null);
        return context;
    }

    private void relay(Socket client) {
        Socket remote = null;
        boolean established = false;
        try {
            remote = connect();
            OutputStream output = remote.getOutputStream();
            output.write(("GET /browser-proxy HTTP/1.1\r\nHost: " + server.getRawAuthority()
                    + "\r\nConnection: Upgrade\r\nUpgrade: codex-http-proxy\r\n" + authorization + "\r\n")
                    .getBytes(StandardCharsets.US_ASCII));
            output.flush();
            InputStream input = new BufferedInputStream(remote.getInputStream());
            ByteArrayOutputStream header = new ByteArrayOutputStream();
            int end = 0;
            while (end != 0x0d0a0d0a && header.size() < 16384) {
                int next = input.read();
                if (next < 0) throw new IOException("代理连接被服务器关闭");
                header.write(next);
                end = (end << 8) | next;
            }
            String response = new String(header.toByteArray(), StandardCharsets.US_ASCII);
            if (end != 0x0d0a0d0a || !response.startsWith("HTTP/1.1 101 ")) {
                throw new IOException("代理连接失败：" + response.split("\r\n", 2)[0]);
            }
            remote.setSoTimeout(0);
            established = true;
            final Socket upstream = remote;
            workers.execute(() -> {
                try { copy(client.getInputStream(), output); upstream.shutdownOutput(); }
                catch (IOException error) { closeSocket(upstream); }
            });
            copy(input, client.getOutputStream());
        } catch (IOException | GeneralSecurityException error) {
            // After switching, WebView owns HTTP/TLS errors. Never insert a 502
            // into that byte stream or report a closed subresource as a page failure.
            if (!closed && !established) {
                onError.accept(error.getMessage());
                try { client.getOutputStream().write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".getBytes(StandardCharsets.US_ASCII)); }
                catch (IOException ignored) {}
            }
        } finally {
            closeSocket(remote);
            closeSocket(client);
        }
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buffer = new byte[32768];
        for (int size; (size = input.read(buffer)) >= 0;) output.write(buffer, 0, size);
    }

    private void closeSocket(Socket socket) {
        if (socket == null) return;
        sockets.remove(socket);
        try { socket.close(); } catch (IOException ignored) {}
    }

    @Override public void close() {
        closed = true;
        try { listener.close(); } catch (IOException ignored) {}
        for (Socket socket : sockets) closeSocket(socket);
        workers.shutdownNow();
    }
}
