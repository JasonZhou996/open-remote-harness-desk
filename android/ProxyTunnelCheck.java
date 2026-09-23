package local.codex.lan;

import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URI;
import java.util.Arrays;

// Run with the deployed server URL, username and one or more target URLs.
// The same ProxyTunnel class is packaged in the Android application.
public final class ProxyTunnelCheck {
    public static void main(String[] args) throws Exception {
        if (args.length < 3) throw new IllegalArgumentException("server username target [target ...]");
        char[] password = System.console().readPassword("Server password (blank for LAN): ");
        java.util.Queue<String> errors = new java.util.concurrent.ConcurrentLinkedQueue<>();
        try (ProxyTunnel tunnel = new ProxyTunnel(args[0], args[1], new String(password), errors::add)) {
            Arrays.fill(password, '\0');
            URI endpoint = URI.create(tunnel.proxyUrl());
            Proxy proxy = new Proxy(Proxy.Type.HTTP, new InetSocketAddress(endpoint.getHost(), endpoint.getPort()));
            for (int i = 2; i < args.length; i++) {
                long start = System.nanoTime();
                HttpURLConnection connection = (HttpURLConnection) URI.create(args[i]).toURL().openConnection(proxy);
                connection.setConnectTimeout(20000);
                connection.setReadTimeout(20000);
                connection.setRequestProperty("Connection", "close");
                try {
                    int status = connection.getResponseCode();
                    if (status != 200) throw new AssertionError(args[i] + " returned " + status + " " + errors);
                    int bytes = 0;
                    byte[] buffer = new byte[32768];
                    try (java.io.InputStream body = connection.getInputStream()) {
                        for (int count; (count = body.read(buffer)) >= 0;) bytes += count;
                    }
                    if (bytes == 0) throw new AssertionError(args[i] + " returned an empty body");
                    if (!errors.isEmpty()) throw new AssertionError(errors.toString());
                    System.out.printf("PASS %s HTTP %d %d bytes %.3fs%n", args[i], status, bytes, (System.nanoTime() - start) / 1e9);
                } finally { connection.disconnect(); }
            }
        }
    }
}
