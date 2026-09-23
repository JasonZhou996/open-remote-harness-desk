package local.codex.lan;

import java.net.URI;

final class ServerAddress {
    static String normalize(String input) {
        String value = input.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("请输入局域网地址");
        if (!value.contains("://")) value = "http://" + value;
        try {
            URI uri = new URI(value);
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    || uri.getHost() == null || uri.getUserInfo() != null
                    || uri.getPort() > 65535 || uri.getPort() == 0)
                throw new IllegalArgumentException();
            return uri.toASCIIString();
        } catch (Exception error) {
            throw new IllegalArgumentException("请输入有效地址，例如 http://192.168.1.100:8899");
        }
    }
}
