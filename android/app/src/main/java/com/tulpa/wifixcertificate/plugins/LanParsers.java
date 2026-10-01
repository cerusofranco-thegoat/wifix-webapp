package com.tulpa.wifixcertificate.plugins;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * LanParsers — lógica PURA (sin dependencias de Android) del escaneo de red
 * interna: construcción de paquetes binarios y parsers de respuestas.
 *
 * Port literal de Wifix Remote (motor Node):
 *  - netprobe.js : statsFromRtts, buildReverseName, encodeName, decodeName,
 *                  parseo de la respuesta PTR (mdnsResolve / unicastPtrResolve),
 *                  NETBIOS_REQUEST + parser de node status, guessDeviceType,
 *                  guessTypeByPorts.
 *  - discovery.js: readName, skipName, parseDnsRecords, encodeName, buildQuery,
 *                  mapServiceType, KNOWN_SERVICES, instanceLabel, correlación
 *                  mDNS (PTR→SRV→A + TXT), M-SEARCH, LOCATION, parseUpnpXml,
 *                  mapUpnpType, banner HTTP (realm/title), fusión discoverNetwork.
 *
 * Al no tocar android.* se prueba con JUnit en la JVM (src/test). Las
 * diferencias de semántica JS→Java se resuelven a favor de JS:
 *  - lecturas fuera de rango del buffer valen 0 (en JS undefined → 0 en
 *    operaciones de bits),
 *  - Buffer.toString(start,end) recorta end al largo,
 *  - String.prototype.trim (jsTrim) y "$" de JS (= \z en Java).
 */
public final class LanParsers {

    private LanParsers() {}

    // =======================================================================
    // Utilidades de bajo nivel
    // =======================================================================

    /** Byte sin signo en i; 0 si está fuera de rango (JS: undefined → 0 en bit-ops). */
    static int u8(byte[] b, int len, int i) {
        return (b != null && i >= 0 && i < len && i < b.length) ? (b[i] & 0xFF) : 0;
    }

    /** Equivalente a buf.toString('utf8', start, end) de Node (recorta a len). */
    static String utf8(byte[] b, int start, int end, int len) {
        int s = Math.max(0, Math.min(start, len));
        int e = Math.max(s, Math.min(end, len));
        if (e <= s) return "";
        return new String(b, s, e - s, StandardCharsets.UTF_8);
    }

    /** Equivalente a buf.toString('latin1', start, end) de Node. */
    static String latin1(byte[] b, int start, int end, int len) {
        int s = Math.max(0, Math.min(start, len));
        int e = Math.max(s, Math.min(end, len));
        if (e <= s) return "";
        return new String(b, s, e - s, StandardCharsets.ISO_8859_1);
    }

    private static boolean isJsWhitespace(char c) {
        switch (c) {
            case '\t': case '\n': case '\u000B': case '\f': case '\r': case ' ':
            case ' ': case ' ': case ' ': case ' ':
            case ' ': case ' ': case '　': case '﻿':
                return true;
            default:
                return c >= ' ' && c <= ' ';
        }
    }

    /** String.prototype.trim de JS (no recorta controles < 0x20 que no sean espacio). */
    static String jsTrim(String s) {
        if (s == null) return null;
        int a = 0, z = s.length();
        while (a < z && isJsWhitespace(s.charAt(a))) a++;
        while (z > a && isJsWhitespace(s.charAt(z - 1))) z--;
        return s.substring(a, z);
    }

    private static boolean empty(String s) {
        return s == null || s.isEmpty();
    }

    /** Primer string "truthy" (no null, no vacío) — operador || de JS. */
    private static String firstTruthy(String... vals) {
        for (String v : vals) if (!empty(v)) return v;
        return null;
    }

    /** Math.round(n * 10) / 10 de JS. */
    static double r1(double n) {
        return Math.round(n * 10) / 10.0;
    }

    // =======================================================================
    // Estadísticas TCP-ping (netprobe.js:88-118)
    // =======================================================================

    public static final class Stat {
        public Double avg, min, max, time, packetLoss, stddev;
        public int sent, received;
        public double[] samples = new double[0];
    }

    public static Stat statsFromRtts(List<Double> rtts, int attempts) {
        Stat stat = new Stat();
        stat.sent = attempts;
        stat.received = rtts.size();
        stat.samples = new double[rtts.size()];
        for (int i = 0; i < rtts.size(); i++) stat.samples[i] = r1(rtts.get(i));
        if (attempts > 0) {
            int lost = attempts - rtts.size();
            stat.packetLoss = Math.round((Math.max(0, lost) / (double) attempts) * 1000) / 10.0;
        }
        if (!rtts.isEmpty()) {
            double sum = 0, min = Double.POSITIVE_INFINITY, max = Double.NEGATIVE_INFINITY;
            for (double v : rtts) {
                sum += v;
                if (v < min) min = v;
                if (v > max) max = v;
            }
            double avg = sum / rtts.size();
            double variance = 0;
            for (double v : rtts) variance += Math.pow(v - avg, 2);
            variance = variance / rtts.size();
            stat.min = r1(min);
            stat.max = r1(max);
            stat.avg = r1(avg);
            stat.time = r1(avg);
            stat.stddev = r1(Math.sqrt(variance));
        }
        return stat;
    }

    /** Stat de "ningún puerto respondió" (netprobe.js:165). */
    public static Stat noResponseStat() {
        Stat s = new Stat();
        s.packetLoss = 100.0;
        s.sent = 0;
        s.received = 0;
        return s;
    }

    // =======================================================================
    // DNS / mDNS PTR inverso (netprobe.js:247-469)
    // =======================================================================

    public static String buildReverseName(String ip) {
        if (ip == null) return null;
        String[] o = ip.split("\\.", -1);
        if (o.length != 4) return null;
        return o[3] + "." + o[2] + "." + o[1] + "." + o[0] + ".in-addr.arpa";
    }

    /** encodeName de netprobe.js (NO salta labels vacíos). */
    static byte[] encodeNameNetprobe(String name) {
        String[] parts = name.split("\\.", -1);
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        for (String p : parts) {
            byte[] lbl = p.getBytes(StandardCharsets.UTF_8);
            out.write(lbl.length & 0xFF);
            out.write(lbl, 0, lbl.length);
        }
        out.write(0);
        return out.toByteArray();
    }

    /** encodeName de discovery.js (salta labels vacíos). */
    static byte[] encodeNameDiscovery(String name) {
        String[] parts = name.split("\\.", -1);
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        for (String p : parts) {
            if (p.isEmpty()) continue;
            byte[] lbl = p.getBytes(StandardCharsets.UTF_8);
            out.write(lbl.length & 0xFF);
            out.write(lbl, 0, lbl.length);
        }
        out.write(0);
        return out.toByteArray();
    }

    private static byte[] concat(byte[]... parts) {
        int n = 0;
        for (byte[] p : parts) n += p.length;
        byte[] out = new byte[n];
        int o = 0;
        for (byte[] p : parts) {
            System.arraycopy(p, 0, out, o, p.length);
            o += p.length;
        }
        return out;
    }

    /**
     * Query PTR de netprobe.js.
     * mdns=true : flags 0x0000, QCLASS=IN|QU (0x8001)  → mdnsResolve
     * mdns=false: flags 0x0100 (RD), QCLASS=IN (0x0001) → unicastPtrResolve
     */
    public static byte[] buildPtrQuery(String reverseName, boolean mdns) {
        byte[] header = new byte[] {
            0x00, 0x00,
            (byte) (mdns ? 0x00 : 0x01), 0x00,
            0x00, 0x01,
            0x00, 0x00,
            0x00, 0x00,
            0x00, 0x00
        };
        byte[] qname = encodeNameNetprobe(reverseName);
        byte[] qtail = new byte[] { 0x00, 0x0C, (byte) (mdns ? 0x80 : 0x00), 0x01 };
        return concat(header, qname, qtail);
    }

    /** decodeName de netprobe.js (compresión 0xC0, anti-loop 16). */
    static String decodeName(byte[] buf, int len, int offset) {
        List<String> labels = new ArrayList<>();
        int pos = offset;
        int jumps = 0;
        try {
            while (pos < len) {
                int l = u8(buf, len, pos);
                if (l == 0) { pos++; break; }
                if ((l & 0xC0) == 0xC0) {
                    int ptr = ((l & 0x3F) << 8) | u8(buf, len, pos + 1);
                    pos = ptr;
                    if (++jumps > 16) break;
                    continue;
                }
                pos++;
                labels.add(utf8(buf, pos, pos + l, len));
                pos += l;
            }
        } catch (Exception e) {
            return null;
        }
        if (labels.isEmpty()) return null;
        return String.join(".", labels);
    }

    private static final Pattern LOCAL_SUFFIX = Pattern.compile("\\.local\\.?\\z", Pattern.CASE_INSENSITIVE);
    private static final Pattern TRAILING_DOT = Pattern.compile("\\.\\z");

    /**
     * Parseo de la respuesta PTR de mdnsResolve/unicastPtrResolve: cabecera 12B,
     * saltar qdcount preguntas, saltar NAME+TYPE+CLASS+TTL+RDLENGTH del primer
     * answer y decodificar RDATA. Devuelve el nombre amigable (sin ".local" ni
     * punto final) o null. El llamante valida len >= 12.
     */
    public static String parsePtrResponse(byte[] msg, int len) {
        try {
            if (msg == null || len < 12) return null;
            int qdcount = (u8(msg, len, 4) << 8) | u8(msg, len, 5);
            int ancount = (u8(msg, len, 6) << 8) | u8(msg, len, 7);
            if (ancount < 1) return null;
            int pos = 12;
            for (int q = 0; q < qdcount; q++) {
                while (pos < len) {
                    int l = u8(msg, len, pos);
                    if (l == 0) { pos++; break; }
                    if ((l & 0xC0) == 0xC0) { pos += 2; break; }
                    pos += l + 1;
                }
                pos += 4;
            }
            if ((u8(msg, len, pos) & 0xC0) == 0xC0) {
                pos += 2;
            } else {
                while (pos < len && u8(msg, len, pos) != 0) pos += (u8(msg, len, pos) + 1);
                pos += 1;
            }
            pos += 2 + 2 + 4;
            pos += 2;
            String name = decodeName(msg, len, pos);
            if (name == null) return null;
            String friendly = TRAILING_DOT.matcher(LOCAL_SUFFIX.matcher(name).replaceAll("")).replaceAll("");
            return friendly.isEmpty() ? null : friendly;
        } catch (Exception e) {
            return null;
        }
    }

    /** unicastPtrResolve: además descarta el "nombre" igual a la propia IP. */
    public static String parseUnicastPtrResponse(byte[] msg, int len, String ip) {
        String friendly = parsePtrResponse(msg, len);
        if (friendly == null || friendly.equals(ip)) return null;
        return friendly;
    }

    // =======================================================================
    // NetBIOS node status (netprobe.js:476-537)
    // =======================================================================

    public static final byte[] NETBIOS_REQUEST = toBytes(
        0xA2, 0x48, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x20, 0x43, 0x4B, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41,
        0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41,
        0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x41, 0x00, 0x00, 0x21,
        0x00, 0x01
    );
    public static final int NB_BASE = 57;
    public static final int NB_NAME_LEN = 15;
    public static final int NB_BLOCK_LEN = 18;

    private static byte[] toBytes(int... v) {
        byte[] b = new byte[v.length];
        for (int i = 0; i < v.length; i++) b[i] = (byte) v[i];
        return b;
    }

    public static final class NetbiosResult {
        public final String name;
        public final String mac;
        NetbiosResult(String name, String mac) { this.name = name; this.mac = mac; }
    }

    public static final NetbiosResult NETBIOS_EMPTY = new NetbiosResult(null, null);

    private static final Pattern CONTROL_CHARS = Pattern.compile("[\\x00-\\x1F]+");

    public static NetbiosResult parseNetbios(byte[] resp, int len) {
        try {
            if (resp == null || len < NB_BASE) return NETBIOS_EMPTY;
            int nameCount = resp[NB_BASE - 1] & 0xFF;
            if (len < NB_BASE + NB_BLOCK_LEN * (nameCount - 1)) return NETBIOS_EMPTY;
            String computerName = jsTrim(latin1(resp, NB_BASE, NB_BASE + NB_NAME_LEN, len));
            computerName = jsTrim(CONTROL_CHARS.matcher(computerName).replaceAll(""));
            int macOff = NB_BASE + NB_BLOCK_LEN * nameCount;
            String mac = null;
            if (len >= macOff + 6) {
                StringBuilder sb = new StringBuilder();
                for (int n = 0; n < 6; n++) {
                    if (n > 0) sb.append(':');
                    sb.append(String.format(Locale.ROOT, "%02x", resp[macOff + n] & 0xFF));
                }
                mac = sb.toString();
            }
            return new NetbiosResult(
                computerName.isEmpty() ? null : computerName,
                (mac != null && !mac.equals("00:00:00:00:00:00")) ? mac : null);
        } catch (Exception e) {
            return NETBIOS_EMPTY;
        }
    }

    // =======================================================================
    // Heurísticas de tipo (netprobe.js:544-602). En el nativo SOLO se usan
    // para decidir si hace falta el banner HTTP (misma condición que
    // probeDevice: deviceType == null || name == null). El tipo final lo
    // decide el JS.
    // =======================================================================

    private static final String[] JUNK_NAMES = {
        "localhost", "local", "unknown", "generic", "android", "(none)", "localhost.localdomain"
    };
    private static final Pattern ONLY_DASHES = Pattern.compile("^[-\\s]+\\z");

    /** Filtro de nombres basura de probeDevice (netprobe.js:659-669). */
    public static String filterJunkName(String name, String ip) {
        if (name == null) return null;
        String norm = jsTrim(name).toLowerCase(Locale.ROOT);
        if (norm.isEmpty() || ONLY_DASHES.matcher(norm).matches()
                || Arrays.asList(JUNK_NAMES).contains(norm)
                || norm.equals(ip == null ? "" : jsTrim(ip).toLowerCase(Locale.ROOT))) {
            return null;
        }
        return name;
    }

    private static boolean find(String regex, String s) {
        return Pattern.compile(regex).matcher(s).find();
    }

    public static String guessDeviceType(String name) {
        if (name == null || name.isEmpty()) return null;
        String n = name.toLowerCase(Locale.ROOT);
        if (find("chromecast|google-?home|google-?nest|nest-?(mini|hub|audio)", n)) return "Chromecast";
        if (find("android-?tv|shield|mi-?box|fire-?tv|firestick|bravia|aquos|qled|oled|neo.?qled|nano.?cell|crystal|smart.?tv", n)) return "AndroidTV";
        if (find("apple-?tv|appletv", n)) return "AppleTV";
        if (find("\\b(printer|impresora|epson|canon|brother|officejet|deskjet|laserjet|hp[a-z0-9]*print|zebra|citizen)\\b", n)) return "Impresora";
        if (find("iphone|ipad|ipod", n)) return "Móvil";
        if (find("android|galaxy|redmi|huawei|xiaomi|oppo|vivo|moto-?g|pixel", n)) return "Móvil";
        if (find("macbook|imac|mac-?mini|mac-?pro", n)) return "PC";
        if (find("desktop|laptop|pc-|win-|windows|\\bpc\\b", n)) return "PC";
        if (find("nas|synology|qnap|diskstation", n)) return "NAS";
        if (find("router|gateway|tplink|tp-link|huawei-?hg|zte|mikrotik|ubnt|unifi", n)) return "Router";
        if (find("xtrim|\\bb\\d{3,}|\\bhg\\d{2,}|\\beg\\d{2,}|zxhn|\\bf\\d{3,}|\\bont\\b|\\bonu\\b|arris|technicolor|commscope|mitrastar|askey|nokia.*gateway|cable\\s?modem|cablemodem", n)) return "Router";
        if (find("echo|alexa|sonos|homepod", n)) return "Parlante";
        if (find("cam|camera|camara|hikvision|dahua|reolink|tapo", n)) return "Cámara";
        if (find("\\bdeco\\b|decodificador|set-?top|\\bstb\\b|roku|\\btcl\\b|hisense|webos|tizen|lg.*tv|samsung.*tv|vizio|\\buhd\\b|\\bled\\b.*\\btv\\b", n)) return "AndroidTV";
        if (find("\\btv\\b", n)) return "AndroidTV";
        return null;
    }

    public static String guessTypeByPorts(List<Integer> openPorts) {
        if (openPorts == null || openPorts.isEmpty()) return null;
        if (openPorts.contains(9100) || openPorts.contains(515) || openPorts.contains(631)) return "Impresora";
        if (openPorts.contains(445) || openPorts.contains(139)) return "PC";
        if (openPorts.contains(62078)) return "Móvil";
        if (openPorts.contains(554) || openPorts.contains(8554)) return "Cámara";
        if (openPorts.contains(22)) return "PC";
        if (openPorts.contains(1883) || openPorts.contains(8883)) return "IoT";
        return null;
    }

    // =======================================================================
    // DNS multi-record (discovery.js:90-225)
    // =======================================================================

    public static final int TYPE_A = 1;
    public static final int TYPE_PTR = 12;
    public static final int TYPE_TXT = 16;
    public static final int TYPE_SRV = 33;

    static final class NameRead {
        final String name;
        final int next;
        NameRead(String name, int next) { this.name = name; this.next = next; }
    }

    static NameRead readName(byte[] buf, int len, int offset) {
        List<String> labels = new ArrayList<>();
        int pos = offset;
        int jumps = 0;
        int next = -1;
        try {
            while (pos < len) {
                int l = u8(buf, len, pos);
                if (l == 0) { pos++; if (next < 0) next = pos; break; }
                if ((l & 0xC0) == 0xC0) {
                    if (pos + 1 >= len) break;
                    int ptr = ((l & 0x3F) << 8) | u8(buf, len, pos + 1);
                    if (next < 0) next = pos + 2;
                    pos = ptr;
                    if (++jumps > 16) break;
                    continue;
                }
                pos++;
                labels.add(utf8(buf, pos, pos + l, len));
                pos += l;
            }
        } catch (Exception e) {
            return new NameRead(null, offset);
        }
        if (next < 0) next = pos;
        return new NameRead(labels.isEmpty() ? null : String.join(".", labels), next);
    }

    static int skipName(byte[] buf, int len, int offset) {
        int pos = offset;
        while (pos < len) {
            int l = u8(buf, len, pos);
            if (l == 0) { pos++; break; }
            if ((l & 0xC0) == 0xC0) { pos += 2; break; }
            pos += l + 1;
        }
        return pos;
    }

    public static final class DnsRecord {
        public int type;
        public String name;
        /** true si el record trae rdata útil (JS: rec.rdata != null). */
        public boolean hasRdata;
        public String target;     // PTR / SRV
        public int port;          // SRV
        public String ip;         // A
        public Map<String, String> txt; // TXT
    }

    public static List<DnsRecord> parseDnsRecords(byte[] buf, int len) {
        List<DnsRecord> out = new ArrayList<>();
        try {
            if (buf == null || len < 12) return out;
            int qd = (u8(buf, len, 4) << 8) | u8(buf, len, 5);
            int an = (u8(buf, len, 6) << 8) | u8(buf, len, 7);
            int ns = (u8(buf, len, 8) << 8) | u8(buf, len, 9);
            int ar = (u8(buf, len, 10) << 8) | u8(buf, len, 11);
            int pos = 12;
            for (int q = 0; q < qd; q++) {
                pos = skipName(buf, len, pos);
                pos += 4;
            }
            int total = an + ns + ar;
            for (int r = 0; r < total; r++) {
                if (pos + 1 >= len) break;
                NameRead nm = readName(buf, len, pos);
                pos = nm.next;
                if (pos + 10 > len) break;
                int type = (u8(buf, len, pos) << 8) | u8(buf, len, pos + 1);
                int rdlen = (u8(buf, len, pos + 8) << 8) | u8(buf, len, pos + 9);
                int rdStart = pos + 10;
                int rdEnd = rdStart + rdlen;
                if (rdEnd > len) break;
                DnsRecord rec = new DnsRecord();
                rec.type = type;
                rec.name = nm.name;
                if (type == TYPE_PTR) {
                    rec.hasRdata = true;
                    rec.target = readName(buf, len, rdStart).name;
                } else if (type == TYPE_SRV) {
                    rec.hasRdata = true;
                    rec.port = (u8(buf, len, rdStart + 4) << 8) | u8(buf, len, rdStart + 5);
                    rec.target = readName(buf, len, rdStart + 6).name;
                } else if (type == TYPE_A) {
                    if (rdlen >= 4) {
                        rec.hasRdata = true;
                        rec.ip = u8(buf, len, rdStart) + "." + u8(buf, len, rdStart + 1) + "."
                               + u8(buf, len, rdStart + 2) + "." + u8(buf, len, rdStart + 3);
                    }
                } else if (type == TYPE_TXT) {
                    Map<String, String> txt = new LinkedHashMap<>();
                    int tp = rdStart;
                    while (tp < rdEnd) {
                        int l = u8(buf, len, tp);
                        tp++;
                        if (l == 0 || tp + l > rdEnd) { tp += l; continue; }
                        String entry = utf8(buf, tp, tp + l, len);
                        tp += l;
                        int eq = entry.indexOf('=');
                        if (eq > 0) txt.put(entry.substring(0, eq).toLowerCase(Locale.ROOT), entry.substring(eq + 1));
                        else if (!entry.isEmpty()) txt.put(entry.toLowerCase(Locale.ROOT), "");
                    }
                    rec.hasRdata = true;
                    rec.txt = txt;
                }
                out.add(rec);
                pos = rdEnd;
            }
        } catch (Exception e) {
            // devolvemos lo acumulado
        }
        return out;
    }

    /** buildQuery de discovery.js: header + 1 pregunta; qu pone el bit QU. */
    public static byte[] buildQuery(String qname, int qtype, boolean qu) {
        byte[] header = new byte[] {
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x01, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00
        };
        byte[] name = encodeNameDiscovery(qname);
        byte[] tail = new byte[] {
            (byte) ((qtype >> 8) & 0xFF), (byte) (qtype & 0xFF), (byte) (qu ? 0x80 : 0x00), 0x01
        };
        return concat(header, name, tail);
    }

    // =======================================================================
    // Taxonomía mDNS (discovery.js:231-283)
    // =======================================================================

    public static String mapServiceType(String service) {
        if (empty(service)) return null;
        String s = service.toLowerCase(Locale.ROOT);
        if (s.contains("_googlecast")) return "Chromecast";
        if (s.contains("_airplay") || s.contains("_raop")) return "AppleTV";
        if (s.contains("_ipp") || s.contains("_ipps")
                || s.contains("_printer") || s.contains("_pdl-datastream")) return "Impresora";
        if (s.contains("_smb") || s.contains("_afpovertcp")) return "NAS";
        if (s.contains("_spotify-connect")) return "Parlante";
        if (s.contains("_workstation")) return "PC";
        if (s.contains("_hap")) return "IoT";
        if (s.contains("_amzn-wplay")) return "AndroidTV";
        return null;
    }

    public static final String[] KNOWN_SERVICES = {
        "_googlecast._tcp.local",
        "_airplay._tcp.local",
        "_raop._tcp.local",
        "_ipp._tcp.local",
        "_ipps._tcp.local",
        "_printer._tcp.local",
        "_pdl-datastream._tcp.local",
        "_smb._tcp.local",
        "_afpovertcp._tcp.local",
        "_spotify-connect._tcp.local",
        "_http._tcp.local",
        "_workstation._tcp.local",
        "_hap._tcp.local",
        "_amzn-wplay._tcp.local",
        "_googlezone._tcp.local"
    };

    /** Enumeración + KNOWN_SERVICES, en el orden del origen. */
    public static List<String> mdnsBrowseQueries() {
        List<String> q = new ArrayList<>();
        q.add("_services._dns-sd._udp.local");
        q.addAll(Arrays.asList(KNOWN_SERVICES));
        return q;
    }

    private static final Pattern ESCAPED_DOT = Pattern.compile("\\\\\\.");
    private static final Pattern TRAILING_DOTS = Pattern.compile("\\.+\\z");
    private static final Pattern LONG_HEX = Pattern.compile("^[0-9a-f]{12,}\\z", Pattern.CASE_INSENSITIVE);

    public static String instanceLabel(String fullName, String serviceType) {
        if (empty(fullName)) return null;
        String name = fullName;
        if (!empty(serviceType)) {
            int idx = name.toLowerCase(Locale.ROOT).indexOf(serviceType.toLowerCase(Locale.ROOT));
            if (idx != -1) name = name.substring(0, idx);
        }
        name = ESCAPED_DOT.matcher(name).replaceAll(".");
        name = jsTrim(TRAILING_DOTS.matcher(name).replaceAll(""));
        if (name.isEmpty()) return null;
        if (name.indexOf(':') != -1) return null;
        if (LONG_HEX.matcher(name).find()) return null;
        if (name.length() > 40 && name.indexOf(' ') == -1) return null;
        return name;
    }

    /** Dispositivo descubierto por mDNS o SSDP (y fusión). */
    public static final class Device {
        public String ip;
        public String name;
        public String type;
        public String source;
        public String manufacturer;
        public String model;
        // prioridades internas de la fusión (discovery.js:773-799)
        int namePri = -1;
        int typePri = -1;
    }

    /** correlate() de mdnsBrowse (discovery.js:318-366). */
    public static List<Device> correlateMdns(List<DnsRecord> records) {
        try {
            List<String[]> ptrs = new ArrayList<>();
            Map<String, DnsRecord> srvByInstance = new java.util.HashMap<>();
            Map<String, String> aByHost = new java.util.HashMap<>();
            Map<String, Map<String, String>> txtByInstance = new java.util.HashMap<>();
            for (DnsRecord r : records) {
                if (r == null || !r.hasRdata) continue;
                if (r.type == TYPE_PTR && !empty(r.target)) {
                    ptrs.add(new String[] { r.name, r.target });
                } else if (r.type == TYPE_SRV && !empty(r.target)) {
                    srvByInstance.put(r.name, r);
                } else if (r.type == TYPE_A && !empty(r.ip)) {
                    aByHost.put(r.name, r.ip);
                } else if (r.type == TYPE_TXT && r.txt != null) {
                    txtByInstance.put(r.name, r.txt);
                }
            }
            Map<String, Device> byIp = new LinkedHashMap<>();
            for (String[] p : ptrs) {
                String service = p[0];
                String instance = p[1];
                if (empty(instance)) continue;
                DnsRecord srv = srvByInstance.get(instance);
                String ip = null;
                if (srv != null && !empty(srv.target)) ip = aByHost.get(srv.target);
                if (empty(ip)) continue;
                String type = mapServiceType(service);
                Map<String, String> txt = txtByInstance.get(instance);
                if (txt == null) txt = new java.util.HashMap<>();
                String name = firstTruthy(txt.get("fn"), txt.get("ty"), txt.get("md"),
                                          instanceLabel(instance, service));
                if (!empty(name)) {
                    name = jsTrim(LOCAL_SUFFIX.matcher(name).replaceAll(""));
                    if (name.isEmpty()) name = null;
                }
                Device prev = byIp.get(ip);
                if (prev == null) {
                    Device d = new Device();
                    d.ip = ip;
                    d.name = empty(name) ? null : name;
                    d.type = type;
                    d.source = "mdns";
                    byIp.put(ip, d);
                } else {
                    if (empty(prev.name) && !empty(name)) prev.name = name;
                    if (empty(prev.type) && !empty(type)) prev.type = type;
                }
            }
            return new ArrayList<>(byIp.values());
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    // =======================================================================
    // SSDP / UPnP (discovery.js:449-636)
    // =======================================================================

    public static final String MSEARCH =
        "M-SEARCH * HTTP/1.1\r\n" +
        "HOST: 239.255.255.250:1900\r\n" +
        "MAN: \"ssdp:discover\"\r\n" +
        "MX: 2\r\n" +
        "ST: ssdp:all\r\n" +
        "\r\n";

    private static final Pattern LOCATION = Pattern.compile("location:\\s*(.+)\\r?\\n", Pattern.CASE_INSENSITIVE);

    public static String parseSsdpLocation(String text) {
        if (text == null) return null;
        Matcher m = LOCATION.matcher(text);
        if (m.find() && !empty(m.group(1))) {
            String v = jsTrim(m.group(1));
            return v.isEmpty() ? null : v;
        }
        return null;
    }

    private static final Pattern NUM_ENTITY = Pattern.compile("&#(\\d+);");

    static String decodeEntities(String s) {
        if (empty(s)) return s;
        s = Pattern.compile("&quot;", Pattern.CASE_INSENSITIVE).matcher(s).replaceAll("\"");
        s = Pattern.compile("&apos;", Pattern.CASE_INSENSITIVE).matcher(s).replaceAll("'");
        s = s.replace("&#39;", "'");
        s = s.replace("&#34;", "\"");
        s = Pattern.compile("&amp;", Pattern.CASE_INSENSITIVE).matcher(s).replaceAll("&");
        s = Pattern.compile("&lt;", Pattern.CASE_INSENSITIVE).matcher(s).replaceAll("<");
        s = Pattern.compile("&gt;", Pattern.CASE_INSENSITIVE).matcher(s).replaceAll(">");
        Matcher m = NUM_ENTITY.matcher(s);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String rep;
            try {
                long code = Long.parseLong(m.group(1));
                rep = String.valueOf((char) (code & 0xFFFF)); // String.fromCharCode → ToUint16
            } catch (Exception e) {
                rep = m.group(0);
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(rep));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static final Pattern CDATA = Pattern.compile("<!\\[CDATA\\[|\\]\\]>");

    static String xmlTag(String xml, String tag) {
        try {
            Pattern re = Pattern.compile("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", Pattern.CASE_INSENSITIVE);
            Matcher m = re.matcher(xml);
            if (!m.find() || empty(m.group(1))) return null;
            String v = decodeEntities(jsTrim(CDATA.matcher(m.group(1)).replaceAll("")));
            return empty(v) ? null : v;
        } catch (Exception e) {
            return null;
        }
    }

    public static final class UpnpInfo {
        public String friendlyName, deviceType, manufacturer, modelName;
    }

    public static UpnpInfo parseUpnpXml(String xml) {
        if (empty(xml)) return null;
        UpnpInfo i = new UpnpInfo();
        i.friendlyName = xmlTag(xml, "friendlyName");
        i.deviceType = xmlTag(xml, "deviceType");
        i.manufacturer = xmlTag(xml, "manufacturer");
        i.modelName = xmlTag(xml, "modelName");
        return i;
    }

    public static String mapUpnpType(String deviceType, String manufacturer, String model, String friendlyName) {
        StringBuilder sb = new StringBuilder();
        for (String v : new String[] { deviceType, manufacturer, model, friendlyName }) {
            if (empty(v)) continue;
            if (sb.length() > 0) sb.append(' ');
            sb.append(v);
        }
        String hay = sb.toString().toLowerCase(Locale.ROOT);
        if (hay.isEmpty()) return null;
        if (find("internetgatewaydevice|wanconnection|router|gateway|wfawlanconfig", hay)) return "Router";
        if (find("printer|impresora|laserjet|officejet|deskjet", hay)) return "Impresora";
        if (find("mediarenderer|mediaserver|dlna|dmr|smart\\s?tv|\\btv\\b|bravia|aquos|webos|tizen|roku", hay)) return "AndroidTV";
        if (find("camera|camara|ipcam|hikvision|dahua|reolink", hay)) return "Cámara";
        if (find("synology|qnap|nas|diskstation", hay)) return "NAS";
        if (find("sonos|speaker|parlante|heos", hay)) return "Parlante";
        return null;
    }

    /** Upgrade incremental de un dispositivo SSDP con su XML (discovery.js:491-501). */
    public static void applyUpnpInfo(Device dev, UpnpInfo info) {
        if (dev == null || info == null) return;
        if (!empty(info.friendlyName) && empty(dev.name)) dev.name = info.friendlyName;
        if (!empty(info.manufacturer) && empty(dev.manufacturer)) dev.manufacturer = info.manufacturer;
        if (!empty(info.modelName) && empty(dev.model)) dev.model = info.modelName;
        if (empty(dev.type)) {
            dev.type = mapUpnpType(info.deviceType, info.manufacturer, info.modelName, info.friendlyName);
        }
    }

    // =======================================================================
    // Banner HTTP (discovery.js:645-716)
    // =======================================================================

    public static final int[] WEB_PORTS = { 80, 8080, 443, 8443 };

    /** Puertos web a probar, en el orden de WEB_PORTS; si no hay ninguno, [80]. */
    public static List<Integer> bannerTargets(List<Integer> openPorts) {
        List<Integer> t = new ArrayList<>();
        for (int p : WEB_PORTS) if (openPorts != null && openPorts.contains(p)) t.add(p);
        if (t.isEmpty()) t.add(80);
        return t;
    }

    public static boolean hasWebPort(List<Integer> openPorts) {
        if (openPorts == null) return false;
        for (int p : WEB_PORTS) if (openPorts.contains(p)) return true;
        return false;
    }

    private static final Pattern REALM = Pattern.compile("realm=\"?([^\",]+)\"?", Pattern.CASE_INSENSITIVE);
    private static final Pattern TITLE = Pattern.compile("<title[^>]*>([\\s\\S]*?)</title>", Pattern.CASE_INSENSITIVE);
    private static final Pattern WS_RUN = Pattern.compile("\\s+");

    public static String parseRealm(String wwwAuthenticate) {
        if (empty(wwwAuthenticate)) return null;
        Matcher m = REALM.matcher(wwwAuthenticate);
        if (m.find() && !empty(m.group(1))) return jsTrim(m.group(1));
        return null;
    }

    public static String parseTitle(String body) {
        if (body == null) return null;
        Matcher m = TITLE.matcher(body);
        if (m.find() && !empty(m.group(1))) {
            String t = jsTrim(WS_RUN.matcher(m.group(1)).replaceAll(" "));
            if (t.length() > 80) t = t.substring(0, 80);
            return t.isEmpty() ? null : t;
        }
        return null;
    }

    // =======================================================================
    // Fusión discoverNetwork (discovery.js:754-813). SSDP: nombre=1, tipo=2;
    // mDNS: nombre=2, tipo=1. Se agregan manufacturer/model (de SSDP).
    // =======================================================================

    public static Map<String, Device> mergeDiscovery(List<Device> mdns, List<Device> ssdp) {
        Map<String, Device> map = new LinkedHashMap<>();
        if (ssdp != null) for (Device d : ssdp) ingest(map, d, 1, 2);
        if (mdns != null) for (Device d : mdns) ingest(map, d, 2, 1);
        return map;
    }

    private static void ingest(Map<String, Device> map, Device dev, int namePri, int typePri) {
        if (dev == null || empty(dev.ip)) return;
        Device cur = map.get(dev.ip);
        if (cur == null) {
            Device d = new Device();
            d.ip = dev.ip;
            d.name = empty(dev.name) ? null : dev.name;
            d.type = empty(dev.type) ? null : dev.type;
            d.source = empty(dev.source) ? null : dev.source;
            d.manufacturer = empty(dev.manufacturer) ? null : dev.manufacturer;
            d.model = empty(dev.model) ? null : dev.model;
            d.namePri = !empty(dev.name) ? namePri : -1;
            d.typePri = !empty(dev.type) ? typePri : -1;
            map.put(dev.ip, d);
            return;
        }
        if (!empty(dev.name) && (empty(cur.name) || namePri > cur.namePri)) {
            cur.name = dev.name;
            cur.namePri = namePri;
        }
        if (!empty(dev.type) && (empty(cur.type) || typePri > cur.typePri)) {
            cur.type = dev.type;
            cur.typePri = typePri;
        }
        if (!empty(cur.source) && !empty(dev.source) && !cur.source.contains(dev.source)) {
            cur.source = cur.source + "+" + dev.source;
        } else if (empty(cur.source) && !empty(dev.source)) {
            cur.source = dev.source;
        }
        if (empty(cur.manufacturer) && !empty(dev.manufacturer)) cur.manufacturer = dev.manufacturer;
        if (empty(cur.model) && !empty(dev.model)) cur.model = dev.model;
    }

    // =======================================================================
    // Red: máscara / prefijo
    // =======================================================================

    public static String netmaskFromPrefix(int prefix) {
        if (prefix < 0 || prefix > 32) return null;
        long mask = prefix == 0 ? 0 : (0xFFFFFFFFL << (32 - prefix)) & 0xFFFFFFFFL;
        return ((mask >> 24) & 0xFF) + "." + ((mask >> 16) & 0xFF) + "."
             + ((mask >> 8) & 0xFF) + "." + (mask & 0xFF);
    }

    /** Prefijo desde una máscara en formato DhcpInfo (little-endian int). -1 si es 0/ inválida. */
    public static int prefixFromDhcpNetmask(int netmaskLe) {
        if (netmaskLe == 0) return -1;
        return Integer.bitCount(netmaskLe);
    }

    /** Prefijo "a.b.c." de la /24 de una IPv4, o null. */
    public static String slash24Prefix(String ip) {
        if (ip == null) return null;
        String[] o = ip.split("\\.", -1);
        if (o.length != 4) return null;
        try {
            for (String s : o) {
                int v = Integer.parseInt(s);
                if (v < 0 || v > 255) return null;
            }
        } catch (NumberFormatException e) {
            return null;
        }
        return o[0] + "." + o[1] + "." + o[2] + ".";
    }
}
