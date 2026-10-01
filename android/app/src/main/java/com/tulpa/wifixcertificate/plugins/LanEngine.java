package com.tulpa.wifixcertificate.plugins;

import android.net.Network;
import android.os.Build;
import android.util.Log;

import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.channels.SelectionKey;
import java.nio.channels.Selector;
import java.nio.channels.SocketChannel;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * LanEngine — sockets del escaneo de red interna (port de netprobe.js y
 * discovery.js de Wifix Remote). Todo es BLOQUEANTE y debe correr fuera del
 * hilo UI (lo invoca NetworkToolsPlugin desde su ExecutorService).
 *
 * Reglas comunes:
 *  - Cada socket se bindea a la Network WiFi (Network.bindSocket, API 23+)
 *    cuando existe, para que un teléfono con WiFi + datos no mande el tráfico
 *    del LAN por la red móvil. En API 22 se usa el ruteo por defecto.
 *  - Ninguna función lanza: ante error devuelven dato vacío/parcial, igual que
 *    el origen Node ("defensivo: ninguna funcion lanza; todas resuelven").
 */
final class LanEngine {

    private static final String TAG = "WifixLan";

    /** Contexto de red: Network WiFi, interfaz y IPv4 local (todos opcionales). */
    static final class Ctx {
        final Network network;
        final NetworkInterface iface;
        final Inet4Address localAddr;
        final ExecutorService exec;

        Ctx(Network network, NetworkInterface iface, Inet4Address localAddr, ExecutorService exec) {
            this.network = network;
            this.iface = iface;
            this.localAddr = localAddr;
            this.exec = exec;
        }
    }

    private LanEngine() {}

    private static final AtomicBoolean bindWarned = new AtomicBoolean(false);

    private static void warnBind(Throwable t) {
        if (bindWarned.compareAndSet(false, true)) {
            Log.w(TAG, "No se pudo bindear el socket a la red WiFi; se usa la ruta por defecto: " + t);
        }
    }

    static void bindToNetwork(Network n, Socket s) {
        if (n == null || s == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        try { n.bindSocket(s); } catch (Throwable t) { warnBind(t); }
    }

    static void bindToNetwork(Network n, DatagramSocket s) {
        if (n == null || s == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        try { n.bindSocket(s); } catch (Throwable t) { warnBind(t); }
    }

    private static void closeQuietly(java.io.Closeable c) {
        if (c == null) return;
        try { c.close(); } catch (Throwable ignored) {}
    }

    // =======================================================================
    // tcpAttempt (netprobe.js:42-82) — en lote con NIO.
    //
    // connect OK → ok (RTT válido); ConnectException por ECONNREFUSED (RST) →
    // ok+refused (host vivo, puerto cerrado, RTT válido); timeout / unreach /
    // cualquier otro error → perdido. Un Selector atiende cientos de connects
    // no bloqueantes a la vez: así el barrido respeta "lotes de 32 IPs × N
    // puertos a 600 ms" sin abrir un hilo por socket.
    // =======================================================================

    static final class TcpResult {
        final boolean ok;
        final boolean refused;
        final double rttMs; // NaN si !ok

        TcpResult(boolean ok, boolean refused, double rttMs) {
            this.ok = ok;
            this.refused = refused;
            this.rttMs = rttMs;
        }
    }

    private static final TcpResult LOST = new TcpResult(false, false, Double.NaN);

    private static double sinceMs(long t0) {
        return (System.nanoTime() - t0) / 1e6;
    }

    static boolean isRefused(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            String m = t.getMessage();
            if (m != null) {
                String l = m.toLowerCase(Locale.ROOT);
                if (l.contains("econnrefused") || l.contains("connection refused")) return true;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP
                    && t instanceof android.system.ErrnoException
                    && ((android.system.ErrnoException) t).errno == android.system.OsConstants.ECONNREFUSED) {
                return true;
            }
            if (t.getCause() == t) break;
        }
        return false;
    }

    /** Un intento TCP por destino, todos en paralelo, cada uno con su timeout. */
    static TcpResult[] tcpAttempts(List<InetSocketAddress> targets, int timeoutMs, Network net) {
        int n = targets.size();
        TcpResult[] out = new TcpResult[n];
        SocketChannel[] ch = new SocketChannel[n];
        long[] t0 = new long[n];
        long timeoutNs = Math.max(1, timeoutMs) * 1_000_000L;
        Selector sel = null;
        try {
            sel = Selector.open();
            int pending = 0;
            for (int i = 0; i < n; i++) {
                InetSocketAddress a = targets.get(i);
                if (a == null || a.isUnresolved()) { out[i] = LOST; continue; }
                SocketChannel sc = null;
                try {
                    sc = SocketChannel.open();
                    sc.configureBlocking(false);
                    bindToNetwork(net, sc.socket());
                    t0[i] = System.nanoTime();
                    if (sc.connect(a)) {
                        out[i] = new TcpResult(true, false, sinceMs(t0[i]));
                        closeQuietly(sc);
                    } else {
                        sc.register(sel, SelectionKey.OP_CONNECT, i);
                        ch[i] = sc;
                        pending++;
                    }
                } catch (Throwable e) {
                    out[i] = isRefused(e) ? new TcpResult(true, true, sinceMs(t0[i])) : LOST;
                    closeQuietly(sc);
                }
            }
            while (pending > 0) {
                long now = System.nanoTime();
                long nearest = Long.MAX_VALUE;
                for (int i = 0; i < n; i++) {
                    if (ch[i] == null) continue;
                    long dl = t0[i] + timeoutNs;
                    if (now >= dl) {
                        out[i] = LOST;
                        closeQuietly(ch[i]);
                        ch[i] = null;
                        pending--;
                    } else if (dl < nearest) {
                        nearest = dl;
                    }
                }
                if (pending <= 0) break;
                long waitMs = Math.max(1, (nearest - now + 999_999) / 1_000_000);
                sel.select(waitMs);
                Iterator<SelectionKey> it = sel.selectedKeys().iterator();
                while (it.hasNext()) {
                    SelectionKey k = it.next();
                    it.remove();
                    int i = (Integer) k.attachment();
                    SocketChannel sc = ch[i];
                    if (sc == null) continue;
                    try {
                        if (!sc.finishConnect()) continue;
                        out[i] = new TcpResult(true, false, sinceMs(t0[i]));
                    } catch (Throwable e) {
                        out[i] = isRefused(e) ? new TcpResult(true, true, sinceMs(t0[i])) : LOST;
                    }
                    k.cancel();
                    closeQuietly(sc);
                    ch[i] = null;
                    pending--;
                }
            }
        } catch (Throwable e) {
            Log.w(TAG, "tcpAttempts: " + e);
        } finally {
            for (int i = 0; i < n; i++) {
                if (ch[i] != null) closeQuietly(ch[i]);
                if (out[i] == null) out[i] = LOST;
            }
            closeQuietly(sel);
        }
        return out;
    }

    static InetAddress resolve(String host, Network net) {
        try {
            return net != null ? net.getByName(host) : InetAddress.getByName(host);
        } catch (Throwable e) {
            return null;
        }
    }

    // =======================================================================
    // tcpPingHost (netprobe.js:146-181)
    // =======================================================================

    static final class HostPing {
        LanParsers.Stat stat;
        boolean respondsTcp;
        Integer openPort;
        List<Integer> openPorts = new ArrayList<>();
    }

    static HostPing tcpPingHost(String host, int[] ports, int count, int timeoutMs, int probeTimeoutMs, Network net) {
        InetAddress addr = resolve(host, net);
        if (ports.length == 1) {
            // Un solo puerto = tcpPingPort (netprobe.js:122-136, p.ej. pingInternet
            // a 8.8.8.8:443): N intentos directos, sin la sonda previa de 800 ms
            // que descartaría un host lejano con RTT > 800 ms.
            HostPing res = new HostPing();
            List<Double> rtts = new ArrayList<>();
            boolean alive = false;
            boolean connected = false;
            for (int i = 0; i < count; i++) {
                TcpResult r = addr == null ? LOST
                    : tcpAttempts(Collections.singletonList(new InetSocketAddress(addr, ports[0])), timeoutMs, net)[0];
                if (r.ok) {
                    alive = true;
                    if (!r.refused) connected = true;
                    if (!Double.isNaN(r.rttMs)) rtts.add(r.rttMs);
                }
            }
            res.stat = LanParsers.statsFromRtts(rtts, count);
            res.respondsTcp = alive;
            res.openPort = alive ? ports[0] : null;
            if (connected) res.openPorts.add(ports[0]);
            return res;
        }
        List<InetSocketAddress> targets = new ArrayList<>();
        for (int p : ports) targets.add(addr == null ? null : new InetSocketAddress(addr, p));

        // Fase 1: 1 intento por puerto, en paralelo.
        TcpResult[] probes = tcpAttempts(targets, probeTimeoutMs, net);
        List<int[]> live = new ArrayList<>(); // {idx}
        HostPing res = new HostPing();
        for (int i = 0; i < ports.length; i++) {
            if (probes[i].ok) live.add(new int[] { i });
            if (probes[i].ok && !probes[i].refused) res.openPorts.add(ports[i]);
        }
        if (live.isEmpty()) {
            res.stat = LanParsers.noResponseStat();
            res.respondsTcp = false;
            res.openPort = null;
            res.openPorts = new ArrayList<>();
            return res;
        }
        // Fase 2: RTT sostenido contra el puerto vivo de menor RTT (sort estable).
        Collections.sort(live, (a, b) -> {
            double ra = Double.isNaN(probes[a[0]].rttMs) ? Double.POSITIVE_INFINITY : probes[a[0]].rttMs;
            double rb = Double.isNaN(probes[b[0]].rttMs) ? Double.POSITIVE_INFINITY : probes[b[0]].rttMs;
            return Double.compare(ra, rb);
        });
        int best = ports[live.get(0)[0]];
        List<InetSocketAddress> one = Collections.singletonList(new InetSocketAddress(addr, best));
        List<Double> rtts = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            TcpResult r = tcpAttempts(one, timeoutMs, net)[0];
            if (r.ok && !Double.isNaN(r.rttMs)) rtts.add(r.rttMs);
        }
        res.stat = LanParsers.statsFromRtts(rtts, count);
        res.respondsTcp = true;
        res.openPort = best;
        return res;
    }

    // =======================================================================
    // sweepSubnet (netprobe.js:195-239)
    // =======================================================================

    static final class SweepHit {
        String ip;
        double rttMs;
        List<Integer> openPorts = new ArrayList<>();
    }

    interface Progress {
        void onProgress(int done, int total);
    }

    static List<SweepHit> sweepSubnet(String prefix, int[] ports, int timeoutMs, int batchSize,
                                      Network net, Progress progress) {
        List<SweepHit> alive = new ArrayList<>();
        String[] o = prefix.split("\\.");
        byte b0 = (byte) Integer.parseInt(o[0]);
        byte b1 = (byte) Integer.parseInt(o[1]);
        byte b2 = (byte) Integer.parseInt(o[2]);
        final int total = 254;
        if (progress != null) progress.onProgress(0, total);
        for (int start = 1; start <= total; start += batchSize) {
            int end = Math.min(total, start + batchSize - 1);
            List<InetSocketAddress> targets = new ArrayList<>();
            for (int h = start; h <= end; h++) {
                InetAddress a;
                try {
                    a = InetAddress.getByAddress(new byte[] { b0, b1, b2, (byte) h });
                } catch (Exception e) {
                    a = null;
                }
                for (int p : ports) targets.add(a == null ? null : new InetSocketAddress(a, p));
            }
            TcpResult[] res = tcpAttempts(targets, timeoutMs, net);
            for (int h = start; h <= end; h++) {
                int base = (h - start) * ports.length;
                SweepHit hit = null;
                for (int k = 0; k < ports.length; k++) {
                    TcpResult r = res[base + k];
                    if (!r.ok) continue;
                    if (hit == null) {
                        hit = new SweepHit();
                        hit.ip = prefix + h;
                        hit.rttMs = Double.POSITIVE_INFINITY;
                    }
                    if (!Double.isNaN(r.rttMs) && r.rttMs < hit.rttMs) hit.rttMs = r.rttMs;
                    if (!r.refused) hit.openPorts.add(ports[k]);
                }
                if (hit != null) alive.add(hit);
            }
            if (progress != null) progress.onProgress(end, total);
        }
        return alive;
    }

    // =======================================================================
    // UDP: mDNS PTR inverso, PTR unicast al gateway y NetBIOS node status.
    // =======================================================================

    private static final int UDP_BUF = 9000;

    /** mdnsResolve (netprobe.js:293-376): PTR con bit QU a 224.0.0.251:5353. */
    static String mdnsResolve(String ip, int timeoutMs, Ctx c) {
        String reverse = LanParsers.buildReverseName(ip);
        if (reverse == null) return null;
        MulticastSocket s = null;
        try {
            s = new MulticastSocket(null);
            s.setReuseAddress(true);
            bindToNetwork(c.network, s);
            s.bind(new InetSocketAddress(0));
            if (c.iface != null) {
                try { s.setNetworkInterface(c.iface); } catch (Throwable ignored) {}
            }
            byte[] pkt = LanParsers.buildPtrQuery(reverse, true);
            s.send(new DatagramPacket(pkt, pkt.length, InetAddress.getByName("224.0.0.251"), 5353));
            long deadline = System.currentTimeMillis() + timeoutMs;
            byte[] buf = new byte[UDP_BUF];
            while (true) {
                long rem = deadline - System.currentTimeMillis();
                if (rem <= 0) return null;
                s.setSoTimeout((int) Math.max(1, rem));
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try {
                    s.receive(p);
                } catch (SocketTimeoutException te) {
                    return null;
                }
                // Mensaje < 12 bytes: no es respuesta útil, seguimos esperando.
                if (p.getLength() < 12) continue;
                return LanParsers.parsePtrResponse(p.getData(), p.getLength());
            }
        } catch (Throwable e) {
            return null;
        } finally {
            closeQuietly(s);
        }
    }

    /** unicastPtrResolve (netprobe.js:390-469): PTR clásico (RD) al gateway:53. */
    static String unicastPtrResolve(String ip, String dnsServerIp, int timeoutMs, Ctx c) {
        if (dnsServerIp == null || dnsServerIp.isEmpty()) return null;
        String reverse = LanParsers.buildReverseName(ip);
        if (reverse == null) return null;
        DatagramSocket s = null;
        try {
            InetAddress server = resolve(dnsServerIp, null);
            if (server == null) return null;
            s = new DatagramSocket(null);
            bindToNetwork(c.network, s);
            s.bind(new InetSocketAddress(0));
            byte[] pkt = LanParsers.buildPtrQuery(reverse, false);
            s.send(new DatagramPacket(pkt, pkt.length, server, 53));
            s.setSoTimeout(Math.max(1, timeoutMs));
            byte[] buf = new byte[UDP_BUF];
            DatagramPacket p = new DatagramPacket(buf, buf.length);
            try {
                s.receive(p);
            } catch (SocketTimeoutException te) {
                return null;
            }
            if (p.getLength() < 12) return null;
            return LanParsers.parseUnicastPtrResponse(p.getData(), p.getLength(), ip);
        } catch (Throwable e) {
            return null;
        } finally {
            closeQuietly(s);
        }
    }

    /** netbiosResolve (netprobe.js:487-537): node status a UDP 137. */
    static LanParsers.NetbiosResult netbiosResolve(String ip, int timeoutMs, Ctx c) {
        DatagramSocket s = null;
        try {
            InetAddress target = resolve(ip, null);
            if (target == null) return LanParsers.NETBIOS_EMPTY;
            s = new DatagramSocket(null);
            bindToNetwork(c.network, s);
            s.bind(new InetSocketAddress(0));
            byte[] req = LanParsers.NETBIOS_REQUEST;
            s.send(new DatagramPacket(req, req.length, target, 137));
            s.setSoTimeout(Math.max(1, timeoutMs));
            byte[] buf = new byte[UDP_BUF];
            DatagramPacket p = new DatagramPacket(buf, buf.length);
            try {
                s.receive(p);
            } catch (SocketTimeoutException te) {
                return LanParsers.NETBIOS_EMPTY;
            }
            return LanParsers.parseNetbios(p.getData(), p.getLength());
        } catch (Throwable e) {
            return LanParsers.NETBIOS_EMPTY;
        } finally {
            closeQuietly(s);
        }
    }

    // =======================================================================
    // Banner HTTP (discovery.js:647-716)
    // =======================================================================

    static final class Banner {
        String server, realm, title;

        boolean hasAny() {
            return notEmpty(server) || notEmpty(realm) || notEmpty(title);
        }
    }

    private static boolean notEmpty(String s) {
        return s != null && !s.isEmpty();
    }

    private static HttpURLConnection open(URL u, Network net) throws Exception {
        return (HttpURLConnection) (net != null ? net.openConnection(u) : u.openConnection());
    }

    static Banner httpBanner(String ip, List<Integer> openPorts, int timeoutMs, Ctx c) {
        if (ip == null) return null;
        for (int port : LanParsers.bannerTargets(openPorts)) {
            Banner b = grabOne(ip, port, timeoutMs, c);
            if (b != null && b.hasAny()) return b;
        }
        return null;
    }

    /**
     * GET / con tope total timeoutMs+300. HTTPS (443/8443) usa la validación
     * de certificados del sistema: NO se instala un TrustManager "acepta todo"
     * (Play lo marca como inseguro). Un panel con certificado autofirmado
     * devuelve null en 443/8443; 80/8080 no se ven afectados.
     */
    static Banner grabOne(final String ip, final int port, final int timeoutMs, final Ctx c) {
        final AtomicReference<HttpURLConnection> ref = new AtomicReference<>();
        Callable<Banner> task = () -> {
            boolean secure = (port == 443 || port == 8443);
            URL u = new URL(secure ? "https" : "http", ip, port, "/");
            HttpURLConnection conn = open(u, c.network);
            ref.set(conn);
            conn.setConnectTimeout(timeoutMs);
            conn.setReadTimeout(timeoutMs);
            conn.setInstanceFollowRedirects(false);
            conn.setUseCaches(false);
            conn.setRequestMethod("GET");
            conn.setRequestProperty("User-Agent", "WiFix-Discovery/1.0");
            conn.setRequestProperty("Accept", "*/*");
            conn.setRequestProperty("Connection", "close");
            int code = conn.getResponseCode();
            Banner b = new Banner();
            String server = conn.getHeaderField("Server");
            b.server = server != null ? server : null;
            b.realm = LanParsers.parseRealm(conn.getHeaderField("WWW-Authenticate"));
            try {
                InputStream in = null;
                try { in = code >= 400 ? conn.getErrorStream() : conn.getInputStream(); }
                catch (Exception e) { in = conn.getErrorStream(); }
                if (in != null) {
                    StringBuilder body = new StringBuilder();
                    byte[] chunk = new byte[4096];
                    int r;
                    while (body.length() < 4096 && (r = in.read(chunk)) != -1) {
                        body.append(new String(chunk, 0, r, StandardCharsets.UTF_8));
                    }
                    closeQuietly(in);
                    b.title = LanParsers.parseTitle(body.toString());
                }
            } catch (Exception e) {
                b.title = null;
            }
            return b;
        };
        Future<Banner> f = null;
        try {
            f = c.exec.submit(task);
            return f.get(timeoutMs + 300L, TimeUnit.MILLISECONDS);
        } catch (Throwable e) {
            if (f != null) f.cancel(true);
            return null;
        } finally {
            HttpURLConnection conn = ref.get();
            if (conn != null) {
                try { conn.disconnect(); } catch (Throwable ignored) {}
            }
        }
    }

    // =======================================================================
    // probeDevice (netprobe.js:626-720) — datos crudos; nombre/tipo final en JS.
    // =======================================================================

    static final int[] PROBE_PORTS = { 80, 443, 22, 445, 7, 8080, 53, 139 };

    static final class ProbeResult {
        String ip;
        HostPing ping;
        String mdnsName;
        String netbiosName;
        String netbiosMac;
        String ptrName;
        Banner banner;
    }

    static ProbeResult probeHost(final String ip, final String gatewayIp, final Ctx c) {
        ProbeResult out = new ProbeResult();
        out.ip = ip;
        Future<HostPing> fPing = c.exec.submit(() -> tcpPingHost(ip, PROBE_PORTS, 4, 1500, 800, c.network));
        Future<String> fMdns = c.exec.submit(() -> mdnsResolve(ip, 1200, c));
        Future<LanParsers.NetbiosResult> fNb = c.exec.submit(() -> netbiosResolve(ip, 1000, c));
        Future<String> fPtr = (gatewayIp != null && !gatewayIp.isEmpty())
            ? c.exec.submit(() -> unicastPtrResolve(ip, gatewayIp, 1200, c))
            : null;

        out.ping = getOr(fPing, 20000, null);
        if (out.ping == null) {
            out.ping = new HostPing();
            out.ping.stat = LanParsers.noResponseStat();
        }
        out.mdnsName = getOr(fMdns, 5000, null);
        LanParsers.NetbiosResult nb = getOr(fNb, 5000, LanParsers.NETBIOS_EMPTY);
        out.netbiosName = nb.name;
        out.netbiosMac = nb.mac;
        out.ptrName = fPtr != null ? getOr(fPtr, 5000, null) : null;

        // Misma condición que probeDevice para el banner: hay puerto web
        // abierto y aún falta tipo o nombre.
        String name = firstNonEmpty(out.mdnsName, out.netbiosName, out.ptrName);
        name = LanParsers.filterJunkName(name, ip);
        String type = LanParsers.guessDeviceType(name);
        if (type == null) type = LanParsers.guessTypeByPorts(out.ping.openPorts);
        if ((type == null || name == null) && LanParsers.hasWebPort(out.ping.openPorts)) {
            out.banner = httpBanner(ip, out.ping.openPorts, 1500, c);
        }
        return out;
    }

    private static String firstNonEmpty(String... v) {
        for (String s : v) if (s != null && !s.isEmpty()) return s;
        return null;
    }

    static <T> T getOr(Future<T> f, long timeoutMs, T fallback) {
        try {
            T v = f.get(timeoutMs, TimeUnit.MILLISECONDS);
            return v != null ? v : fallback;
        } catch (Throwable e) {
            f.cancel(true);
            return fallback;
        }
    }

    // =======================================================================
    // mDNS browse (discovery.js:300-429)
    // =======================================================================

    private static void sendAll(MulticastSocket s, List<byte[]> pkts, InetAddress group, int port) {
        for (byte[] pkt : pkts) {
            try { s.send(new DatagramPacket(pkt, pkt.length, group, port)); } catch (Throwable ignored) {}
        }
    }

    private static MulticastSocket openMulticast(Ctx c, InetSocketAddress bindAddr, InetSocketAddress fallback) throws Exception {
        MulticastSocket s = new MulticastSocket(null);
        s.setReuseAddress(true);
        bindToNetwork(c.network, s);
        try {
            s.bind(bindAddr);
            return s;
        } catch (Exception e) {
            closeQuietly(s);
            if (fallback == null) throw e;
            Log.w(TAG, "bind " + bindAddr + " falló (" + e.getMessage() + "); se usa " + fallback);
            MulticastSocket s2 = new MulticastSocket(null);
            s2.setReuseAddress(true);
            bindToNetwork(c.network, s2);
            s2.bind(fallback);
            return s2;
        }
    }

    static List<LanParsers.Device> mdnsBrowse(int timeoutMs, Ctx c) {
        List<LanParsers.DnsRecord> records = new ArrayList<>();
        MulticastSocket s = null;
        InetAddress group = null;
        boolean joined = false;
        try {
            group = InetAddress.getByName("224.0.0.251");
            // :5353 con reuseAddr para recibir el multicast; si el sistema no lo
            // permite, puerto efímero: con el bit QU los responders contestan
            // unicast a nuestro puerto (legacy unicast).
            s = openMulticast(c, new InetSocketAddress(5353), new InetSocketAddress(0));
            try { s.setTimeToLive(255); } catch (Throwable ignored) {}
            if (c.iface != null) {
                try { s.setNetworkInterface(c.iface); } catch (Throwable ignored) {}
            }
            try {
                if (c.iface != null) s.joinGroup(new InetSocketAddress(group, 5353), c.iface);
                else s.joinGroup(group);
                joined = true;
            } catch (Throwable e) {
                try { s.joinGroup(group); joined = true; } catch (Throwable ignored) {}
            }

            List<byte[]> pkts = new ArrayList<>();
            for (String q : LanParsers.mdnsBrowseQueries()) {
                pkts.add(LanParsers.buildQuery(q, LanParsers.TYPE_PTR, true));
            }
            long start = System.currentTimeMillis();
            long t1 = start + Math.min(1200, timeoutMs / 3);
            long t2 = start + Math.min(2400, (timeoutMs * 2) / 3);
            long deadline = start + timeoutMs;
            boolean sent1 = false, sent2 = false;
            sendAll(s, pkts, group, 5353);
            byte[] buf = new byte[UDP_BUF];
            while (true) {
                long now = System.currentTimeMillis();
                if (!sent1 && now >= t1) { sendAll(s, pkts, group, 5353); sent1 = true; }
                if (!sent2 && now >= t2) { sendAll(s, pkts, group, 5353); sent2 = true; }
                if (now >= deadline) break;
                long next = deadline;
                if (!sent1) next = Math.min(next, t1);
                if (!sent2) next = Math.min(next, t2);
                s.setSoTimeout((int) Math.max(1, next - now));
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try {
                    s.receive(p);
                    records.addAll(LanParsers.parseDnsRecords(p.getData(), p.getLength()));
                } catch (SocketTimeoutException ignored) {
                    // siguiente evento
                }
            }
        } catch (Throwable e) {
            Log.w(TAG, "mdnsBrowse: " + e);
        } finally {
            if (s != null && joined && group != null) {
                try { s.leaveGroup(group); } catch (Throwable ignored) {}
            }
            closeQuietly(s);
        }
        return LanParsers.correlateMdns(records);
    }

    // =======================================================================
    // SSDP M-SEARCH (discovery.js:439-622)
    // =======================================================================

    static List<LanParsers.Device> ssdpDiscover(int timeoutMs, final Ctx c) {
        final Map<String, LanParsers.Device> byIp = new LinkedHashMap<>();
        final Map<String, Boolean> locations = new HashMap<>();
        final Map<String, Integer> fetchesPerIp = new HashMap<>();
        final List<Future<?>> pending = new ArrayList<>();
        MulticastSocket s = null;
        try {
            InetAddress group = InetAddress.getByName("239.255.255.250");
            InetSocketAddress lan = c.localAddr != null ? new InetSocketAddress(c.localAddr, 0) : new InetSocketAddress(0);
            s = openMulticast(c, lan, c.localAddr != null ? new InetSocketAddress(0) : null);
            try { s.setTimeToLive(2); } catch (Throwable ignored) {}
            if (c.iface != null) {
                try { s.setNetworkInterface(c.iface); } catch (Throwable ignored) {}
            }
            byte[] msearch = LanParsers.MSEARCH.getBytes(StandardCharsets.UTF_8);
            List<byte[]> pkts = Collections.singletonList(msearch);

            long start = System.currentTimeMillis();
            long t1 = start + Math.min(1000, timeoutMs / 3);
            long t2 = start + Math.min(2000, (timeoutMs * 2) / 3);
            long deadline = start + timeoutMs;
            boolean sent1 = false, sent2 = false;
            sendAll(s, pkts, group, 1900);
            byte[] buf = new byte[UDP_BUF];
            while (true) {
                long now = System.currentTimeMillis();
                if (!sent1 && now >= t1) { sendAll(s, pkts, group, 1900); sent1 = true; }
                if (!sent2 && now >= t2) { sendAll(s, pkts, group, 1900); sent2 = true; }
                if (now >= deadline) break;
                long next = deadline;
                if (!sent1) next = Math.min(next, t1);
                if (!sent2) next = Math.min(next, t2);
                s.setSoTimeout((int) Math.max(1, next - now));
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try {
                    s.receive(p);
                } catch (SocketTimeoutException ignored) {
                    continue;
                }
                String text = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                final String location = LanParsers.parseSsdpLocation(text);
                if (location == null || locations.containsKey(location)) continue;
                locations.put(location, true);
                final String ip;
                try {
                    ip = new URL(location).getHost();
                } catch (Exception e) {
                    continue;
                }
                if (ip == null || ip.isEmpty()) continue;
                int n = fetchesPerIp.containsKey(ip) ? fetchesPerIp.get(ip) : 0;
                if (n >= 3) continue;
                fetchesPerIp.put(ip, n + 1);
                synchronized (byIp) {
                    if (!byIp.containsKey(ip)) {
                        LanParsers.Device d = new LanParsers.Device();
                        d.ip = ip;
                        d.source = "ssdp";
                        byIp.put(ip, d);
                    }
                }
                pending.add(c.exec.submit(() -> {
                    LanParsers.UpnpInfo info = fetchDescription(location, c);
                    if (info == null) return;
                    synchronized (byIp) {
                        LanParsers.applyUpnpInfo(byIp.get(ip), info);
                    }
                }));
            }
        } catch (Throwable e) {
            Log.w(TAG, "ssdpDiscover: " + e);
        } finally {
            closeQuietly(s);
        }
        // Esperamos los fetch XML pendientes (cada uno con su tope de 2 s).
        long waitUntil = System.currentTimeMillis() + 2500;
        for (Future<?> f : pending) {
            long rem = waitUntil - System.currentTimeMillis();
            try {
                f.get(Math.max(1, rem), TimeUnit.MILLISECONDS);
            } catch (Throwable e) {
                f.cancel(true);
            }
        }
        synchronized (byIp) {
            return new ArrayList<>(byIp.values());
        }
    }

    /** fetchDescription (discovery.js:553-588): GET del XML, tope 64 KB / 2 s. */
    static LanParsers.UpnpInfo fetchDescription(final String location, final Ctx c) {
        final AtomicReference<HttpURLConnection> ref = new AtomicReference<>();
        Callable<LanParsers.UpnpInfo> task = () -> {
            URL u = new URL(location);
            HttpURLConnection conn = open(u, c.network);
            ref.set(conn);
            conn.setConnectTimeout(1500);
            conn.setReadTimeout(1500);
            conn.setInstanceFollowRedirects(false);
            conn.setUseCaches(false);
            conn.setRequestMethod("GET");
            int code = conn.getResponseCode();
            InputStream in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (in == null) return null;
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int r;
            while (bos.size() <= 65536 && (r = in.read(chunk)) != -1) bos.write(chunk, 0, r);
            closeQuietly(in);
            return LanParsers.parseUpnpXml(new String(bos.toByteArray(), StandardCharsets.UTF_8));
        };
        Future<LanParsers.UpnpInfo> f = null;
        try {
            f = c.exec.submit(task);
            return f.get(2000, TimeUnit.MILLISECONDS);
        } catch (Throwable e) {
            if (f != null) f.cancel(true);
            return null;
        } finally {
            HttpURLConnection conn = ref.get();
            if (conn != null) {
                try { conn.disconnect(); } catch (Throwable ignored) {}
            }
        }
    }

    /** discoverNetwork (discovery.js:754-813): mDNS + SSDP en paralelo y fusión. */
    static Map<String, LanParsers.Device> discoverNetwork(final int mdnsMs, final int ssdpMs, final Ctx c) {
        Future<List<LanParsers.Device>> fm = c.exec.submit(() -> mdnsBrowse(mdnsMs, c));
        Future<List<LanParsers.Device>> fs = c.exec.submit(() -> ssdpDiscover(ssdpMs, c));
        List<LanParsers.Device> mdns = getOr(fm, mdnsMs + 5000L, new ArrayList<>());
        List<LanParsers.Device> ssdp = getOr(fs, ssdpMs + 8000L, new ArrayList<>());
        return LanParsers.mergeDiscovery(mdns, ssdp);
    }
}
