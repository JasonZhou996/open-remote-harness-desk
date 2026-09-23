package local.codex.lan;

import java.io.IOException;
import java.io.StringReader;
import java.io.StringWriter;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Properties;

/** Device-local saved connections and the ten most recent unsaved connections. */
final class ConnectionHistory {
    static final class Entry {
        final String url, password;
        final boolean saved;
        Entry(String url, String password, boolean saved) {
            this.url = url; this.password = password; this.saved = saved;
        }
    }

    final List<Entry> entries = new ArrayList<>();

    private static String key(String address) {
        URI uri = URI.create(ServerAddress.normalize(address)).normalize();
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        int port = uri.getPort();
        if ((port == 80 && scheme.equals("http")) || (port == 443 && scheme.equals("https"))) port = -1;
        try {
            String origin = new URI(scheme, null, uri.getHost().toLowerCase(Locale.ROOT), port, null, null, null).toASCIIString();
            return origin + (uri.getRawPath().isEmpty() ? "/" : uri.getRawPath())
                    + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery())
                    + (uri.getRawFragment() == null ? "" : "#" + uri.getRawFragment());
        } catch (java.net.URISyntaxException invalid) { throw new IllegalArgumentException(invalid); }
    }

    Entry find(String url) {
        try {
            String normalized = key(url);
            for (Entry entry : entries) if (entry.url.equals(normalized)) return entry;
        } catch (IllegalArgumentException ignored) { }
        return null;
    }

    void put(String url, String password, boolean saved) {
        String normalized = key(url);
        entries.removeIf(entry -> entry.url.equals(normalized));
        entries.add(0, new Entry(normalized, password, saved));
        int recent = 0;
        java.util.Iterator<Entry> iterator = entries.iterator();
        while (iterator.hasNext()) if (!iterator.next().saved && ++recent > 10) iterator.remove();
    }

    void remove(String url) {
        Entry entry = find(url);
        if (entry != null) entries.remove(entry);
    }

    String encode() {
        Properties values = new Properties();
        for (int i = 0; i < entries.size(); i++) {
            Entry entry = entries.get(i);
            values.setProperty(i + ".url", entry.url);
            values.setProperty(i + ".password", entry.password);
            values.setProperty(i + ".saved", Boolean.toString(entry.saved));
        }
        StringWriter output = new StringWriter();
        try { values.store(output, null); }
        catch (IOException impossible) { throw new IllegalStateException(impossible); }
        return output.toString();
    }

    static ConnectionHistory load(String encoded, String legacyUrl, String legacyPassword) {
        ConnectionHistory history = new ConnectionHistory();
        Properties values = new Properties();
        try { values.load(new StringReader(encoded)); }
        catch (IOException | IllegalArgumentException invalid) { return history; }
        int count = 0;
        while (values.containsKey(count + ".url")) count++;
        for (int i = count - 1; i >= 0; i--) {
            try {
                history.put(values.getProperty(i + ".url"), values.getProperty(i + ".password", ""),
                        Boolean.parseBoolean(values.getProperty(i + ".saved", "false")));
            } catch (IllegalArgumentException ignored) { }
        }
        if (encoded.isEmpty() && legacyUrl != null) {
            try { history.put(legacyUrl, legacyPassword, false); }
            catch (IllegalArgumentException ignored) { }
        }
        return history;
    }
}
