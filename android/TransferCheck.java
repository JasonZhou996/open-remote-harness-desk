package local.codex.lan;

import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

// java -ea -cp build/classes:build/check local.codex.lan.TransferCheck <this computer's LAN IP>
public final class TransferCheck {
    public static void main(String[] args) throws Exception {
        assert FileDownload.filename("https://host/download", "attachment; filename=download; filename*=UTF-8''%E6%89%A7%E8%A1%8C%20%E8%AE%A1%E5%88%92%2B1.md").equals("执行 计划+1.md");
        assert FileDownload.filename("https://host/download", "attachment; filename=\"../../test.txt\"").equals(".._.._test.txt");
        assert FileDownload.filename("https://host/a%20b.apk?q=x", null).equals("a b.apk");
        assert FileDownload.sameOrigin(new URL("https://HOST/a"), new URL("https://host:443/b"));
        assert !FileDownload.sameOrigin(new URL("https://host"), new URL("http://host"));
        assert !FileDownload.sameOrigin(new URL("https://host"), new URL("https://host:444"));
        assert LanConnection.isLan(new URL("http://192.168.1.100:8899"));
        assert !LanConnection.isLan(new URL("http://192.168.999.1"));
        assert !LanConnection.isLan(new URL("http://203.0.113.10"));
        assert !LanConnection.isLan(new URL("http://127.0.0.1"));
        String connected = "http://192.168.1.100:8899", requested = "https://public.example:3391";
        String path = "/api/files/download?path=%2Ftmp%2Ftest.pdf";
        assert FileDownload.appLink(requested + path, connected, requested).equals(connected + path);
        assert FileDownload.appLink(path, connected, requested).equals(connected + path);
        assert FileDownload.appLink("https://unrelated.example" + path, connected, requested) == null;
        assert FileDownload.appLink("https://user:password@public.example:3391" + path, connected, requested) == null;
        assert FileDownload.appLink("javascript:alert(1)", connected, requested) == null;
        HttpServer origin = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        HttpServer lan = HttpServer.create(new InetSocketAddress(args[0], 0), 0);
        String publicUrl = "http://127.0.0.1:" + origin.getAddress().getPort();
        String lanUrl = "http://" + args[0] + ":" + lan.getAddress().getPort();
        AtomicReference<String> id = new AtomicReference<>("same-backend");
        AtomicBoolean leak = new AtomicBoolean(), authorized = new AtomicBoolean();
        AtomicBoolean accessible = new AtomicBoolean(true);
        AtomicBoolean cacheAvailable = new AtomicBoolean(true), backendTouched = new AtomicBoolean();
        byte[] bytes = "文件内容\u0000\u0001".getBytes(StandardCharsets.UTF_8);
        AtomicBoolean remoteTouched = new AtomicBoolean();
        origin.createContext("/api/lan-discovery", exchange -> {
            remoteTouched.set(true);
            if (!cacheAvailable.get()) { exchange.sendResponseHeaders(404, -1); exchange.close(); return; }
            byte[] cached = ("serverId=same-backend\nlanUrl=" + lanUrl + "\n").getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, cached.length);
            exchange.getResponseBody().write(cached); exchange.close();
        });
        origin.createContext("/api/auth/status", exchange -> {
            backendTouched.set(true);
            exchange.sendResponseHeaders(503, -1); exchange.close();
        });
        origin.createContext("/file", exchange -> {
            authorized.set("Basic dXNlcjp0ZXN0".equals(exchange.getRequestHeaders().getFirst("Authorization"))
                    && "session=test".equals(exchange.getRequestHeaders().getFirst("Cookie")));
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes); exchange.close();
        });
        origin.createContext("/redirect", exchange -> {
            exchange.getResponseHeaders().set("Location", lanUrl + "/file");
            exchange.sendResponseHeaders(302, -1); exchange.close();
        });
        lan.createContext("/", exchange -> {
            if (exchange.getRequestHeaders().getFirst("Authorization") != null || exchange.getRequestHeaders().getFirst("Cookie") != null) leak.set(true);
            exchange.getResponseHeaders().set("x-codex-server-id", id.get());
            if (exchange.getRequestURI().getPath().equals("/file")) {
                exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes);
            } else exchange.sendResponseHeaders(accessible.get() ? 200 : 401, -1);
            exchange.close();
        });
        origin.start(); lan.start();
        try {
            ByteArrayOutputStream saved = new ByteArrayOutputStream();
            FileDownload.copy(publicUrl + "/file", publicUrl, "user", "test", "session=test", "check", "", saved);
            assert authorized.get();
            assert java.util.Arrays.equals(bytes, saved.toByteArray());
            saved.reset();
            FileDownload.copy(publicUrl + "/redirect", publicUrl, "user", "test", "session=test", "check", "", saved);
            assert java.util.Arrays.equals(bytes, saved.toByteArray());
            assert !leak.get() : "Credentials leaked across origin";
            LanConnection.Selection selected = LanConnection.prefer(publicUrl + "/zcode?q=x", "user", "test");
            assert selected.url.equals(lanUrl + "/zcode?q=x");
            assert remoteTouched.get() : "Public endpoint was not tried before LAN";
            assert !backendTouched.get() : "LAN discovery must not depend on the backend tunnel";
            id.set("different-backend");
            assert LanConnection.prefer(publicUrl, "user", "test").url.equals(publicUrl);
            id.set("same-backend"); accessible.set(false);
            assert LanConnection.prefer(publicUrl, "user", "test").url.equals(publicUrl);
            assert LanConnection.prefer(lanUrl, "user", "test").url.equals(lanUrl);
            assert !leak.get() : "Public password sent to LAN probe";
            lan.stop(0);
            assert LanConnection.prefer(publicUrl, "user", "test").url.equals(publicUrl);
            cacheAvailable.set(false);
            assert !LanConnection.prefer(publicUrl, "user", "test").publicReachable;
            assert backendTouched.get() : "Older servers must retain their auth/status discovery path";
            System.out.println("PASS: download, scoped auth, public cache works with tunnel unavailable, identity check and public fallback");
        } finally { origin.stop(0); lan.stop(0); }
    }
}
