package local.codex.lan;
public class AddressCheck {
    public static void main(String[] args) {
        assert ServerAddress.normalize(" 192.168.1.100:8899 ").equals("http://192.168.1.100:8899");
        assert ServerAddress.normalize("https://host.local:8899/a").equals("https://host.local:8899/a");
        for (String bad : new String[]{"", "javascript:alert(1)", "file:///tmp/x", "http://u:p@host", "http://host:70000", "http://bad host"}) {
            boolean failed = false;
            try { ServerAddress.normalize(bad); } catch (IllegalArgumentException expected) { failed = true; }
            assert failed : bad;
        }
        System.out.println("Address validation passed");

        ConnectionHistory history = ConnectionHistory.load("", "https://old.example:3391", "old-password");
        assert history.find("https://old.example:3391/").password.equals("old-password") : "Migrate the old connection";
        history.put("https://ONE.example:443", "one", true);
        history.put("https://two.example", "two", false);
        history.put("https://one.example/", "updated", true);
        assert history.entries.size() == 3 : "Equivalent addresses must not duplicate";
        assert history.find("https://one.example").password.equals("updated");
        assert history.find("https://two.example").password.equals("two") : "Passwords stay with their address";
        assert history.find("http://one.example") == null : "Do not reuse HTTPS credentials for HTTP";
        assert history.find("https://one.example:3391") == null : "Different ports are different connections";
        assert history.find("https://other.example") == null : "New addresses have no saved password";
        assert history.find("not a url") == null;
        for (int i = 0; i < 15; i++) history.put("https://recent" + i + ".example", "password-" + i, false);
        assert history.entries.size() == 11 : "Keep ten recent entries plus saved entries";
        assert history.find("https://one.example").saved : "Saved entries must survive history eviction";
        assert history.find("https://recent0.example") == null;
        history = ConnectionHistory.load(history.encode(), null, "");
        assert history.entries.get(0).url.equals("https://recent14.example/") : "Recency survives restart";
        assert history.entries.size() == 11;
        assert history.find("https://one.example").saved;
        assert history.find("https://one.example").password.equals("updated");
        history.put("https://encoded.example/a%2Fb?q=a%26b#x%20y", "汉字:=\\\nsecret", true);
        history = ConnectionHistory.load(history.encode(), null, "");
        assert history.find("https://encoded.example/a%2Fb?q=a%26b#x%20y").password.equals("汉字:=\\\nsecret");
        assert history.find("https://encoded.example/a/b?q=a%26b#x%20y") == null : "Preserve escaped URL components";
        history.put("https://one.example", "updated", false);
        assert !history.find("https://one.example").saved : "Can unpin a connection";
        history.remove("https://one.example");
        history = ConnectionHistory.load(history.encode(), null, "");
        assert history.find("https://one.example") == null : "Deleted credentials stay deleted";
        history.put("https://two.example", "", true);
        assert ConnectionHistory.load(history.encode(), null, "").find("https://two.example").password.isEmpty();
        assert ConnectionHistory.load("", null, "").entries.isEmpty();
        assert ConnectionHistory.load("", "javascript:alert(1)", "secret").entries.isEmpty();
        System.out.println("Connection history migration, persistence, saved entries and credential isolation passed");
    }
}
