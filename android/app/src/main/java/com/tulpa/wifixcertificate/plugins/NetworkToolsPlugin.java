package com.tulpa.wifixcertificate.plugins;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.DhcpInfo;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.RouteInfo;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * NetworkToolsPlugin — capacidades de red que el WebView no puede ejecutar:
 *  - ping(host, count, timeoutSec): ICMP ping via /system/bin/ping
 *  - traceroute(host, maxHops, timeoutSec): TTL incremental usando ping
 *  - getWifiInfo(): SSID, BSSID, RSSI dBm, link speed, IP local
 *
 * El plugin queda registrado en MainActivity.onCreate.
 * Desde JS: Capacitor.Plugins.NetworkTools.ping({host: '8.8.8.8'})
 */
@CapacitorPlugin(
    name = "NetworkTools",
    permissions = {
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_FINE_LOCATION }
        )
    }
)
public class NetworkToolsPlugin extends Plugin {

    // -----------------------------------------------------------------------
    // ping
    // -----------------------------------------------------------------------
    @PluginMethod
    public void ping(PluginCall call) {
        final String host = call.getString("host");
        if (host == null || host.isEmpty()) {
            call.reject("host requerido");
            return;
        }
        final int count = call.getInt("count", 4);
        final int timeoutSec = call.getInt("timeoutSec", 5);

        new Thread(() -> {
            try {
                Process p = new ProcessBuilder()
                    .command("/system/bin/ping",
                             "-c", String.valueOf(count),
                             "-W", String.valueOf(timeoutSec),
                             host)
                    .redirectErrorStream(true)
                    .start();

                String raw = readAll(p);
                int exit = p.waitFor();

                JSObject result = parsePing(raw);
                result.put("host", host);
                result.put("exitCode", exit);
                result.put("raw", raw);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("ping falló: " + e.getMessage(), e);
            }
        }).start();
    }

    private JSObject parsePing(String raw) {
        JSObject r = new JSObject();

        Matcher ms = Pattern
            .compile("(\\d+)\\s+packets?\\s+transmitted,\\s+(\\d+)(?:\\s+packets?)?\\s+received(?:.*?(\\d+)%\\s+packet\\s+loss)?")
            .matcher(raw);
        if (ms.find()) {
            r.put("transmitted", Integer.parseInt(ms.group(1)));
            r.put("received", Integer.parseInt(ms.group(2)));
            if (ms.group(3) != null) r.put("packetLossPct", Integer.parseInt(ms.group(3)));
        }

        Matcher mr = Pattern
            .compile("(?:rtt|round-trip).*?=\\s*([\\d.]+)/([\\d.]+)/([\\d.]+)(?:/([\\d.]+))?\\s*ms")
            .matcher(raw);
        if (mr.find()) {
            r.put("rttMinMs", Double.parseDouble(mr.group(1)));
            r.put("rttAvgMs", Double.parseDouble(mr.group(2)));
            r.put("rttMaxMs", Double.parseDouble(mr.group(3)));
            if (mr.group(4) != null) r.put("rttMdevMs", Double.parseDouble(mr.group(4)));
        }

        Matcher mt = Pattern.compile("time[=<]([\\d.]+)\\s*ms").matcher(raw);
        JSONArray samples = new JSONArray();
        while (mt.find()) samples.put((Object) Double.valueOf(mt.group(1)));
        r.put("samples", samples);

        return r;
    }

    // -----------------------------------------------------------------------
    // traceroute (Android no trae el binario — usamos ping con TTL incremental
    // y leemos las respuestas "Time to live exceeded" de cada hop intermedio)
    // -----------------------------------------------------------------------
    @PluginMethod
    public void traceroute(PluginCall call) {
        final String host = call.getString("host");
        if (host == null || host.isEmpty()) {
            call.reject("host requerido");
            return;
        }
        final int maxHops = call.getInt("maxHops", 30);
        final int timeoutSec = call.getInt("timeoutSec", 3);

        new Thread(() -> {
            try {
                JSONArray hops = new JSONArray();
                InetAddress target = InetAddress.getByName(host);
                boolean reached = false;

                for (int ttl = 1; ttl <= maxHops && !reached; ttl++) {
                    long start = System.currentTimeMillis();
                    Process p = new ProcessBuilder()
                        .command("/system/bin/ping",
                                 "-c", "1",
                                 "-W", String.valueOf(timeoutSec),
                                 "-t", String.valueOf(ttl),
                                 host)
                        .redirectErrorStream(true)
                        .start();
                    String raw = readAll(p);
                    p.waitFor();
                    long elapsed = System.currentTimeMillis() - start;

                    JSObject hop = new JSObject();
                    hop.put("ttl", ttl);
                    hop.put("elapsedMs", elapsed);

                    Matcher mh = Pattern
                        .compile("From\\s+([\\d.]+).*?(Time to live exceeded|TTL exceeded)", Pattern.CASE_INSENSITIVE | Pattern.DOTALL)
                        .matcher(raw);
                    if (mh.find()) {
                        hop.put("ip", mh.group(1));
                        hop.put("status", "intermediate");
                    } else {
                        Matcher me = Pattern
                            .compile("\\d+\\s+bytes\\s+from\\s+([\\d.]+).*?time[=<]([\\d.]+)\\s*ms", Pattern.DOTALL)
                            .matcher(raw);
                        if (me.find()) {
                            hop.put("ip", me.group(1));
                            hop.put("rttMs", Double.parseDouble(me.group(2)));
                            hop.put("status", "reached");
                            reached = true;
                        } else {
                            hop.put("status", "timeout");
                        }
                    }
                    hops.put(hop);
                }

                JSObject result = new JSObject();
                result.put("host", host);
                result.put("targetIp", target.getHostAddress());
                result.put("hops", hops);
                result.put("reached", reached);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("traceroute falló: " + e.getMessage(), e);
            }
        }).start();
    }

    // -----------------------------------------------------------------------
    // pingOnce — un solo ping ICMP (modo "uno por uno" en vivo; el bucle lo
    // maneja JS). Devuelve status reply/timeout/unreachable + datos del reply.
    // -----------------------------------------------------------------------
    @PluginMethod
    public void pingOnce(PluginCall call) {
        final String host = call.getString("host");
        if (host == null || host.isEmpty()) {
            call.reject("host requerido");
            return;
        }
        final int timeoutSec = call.getInt("timeoutSec", 3);

        new Thread(() -> {
            try {
                Process p = new ProcessBuilder()
                    .command("/system/bin/ping",
                             "-c", "1",
                             "-W", String.valueOf(timeoutSec),
                             host)
                    .redirectErrorStream(true)
                    .start();

                String raw = readAll(p);
                int exit = p.waitFor();

                JSObject result = new JSObject();
                result.put("raw", raw);
                result.put("exitCode", exit);

                Matcher mr = Pattern
                    .compile("(\\d+)\\s+bytes\\s+from\\s+([\\d.]+):.*?ttl=(\\d+).*?time[=<]([\\d.]+)\\s*ms", Pattern.CASE_INSENSITIVE | Pattern.DOTALL)
                    .matcher(raw);
                if (mr.find()) {
                    result.put("status", "reply");
                    result.put("bytes", Integer.parseInt(mr.group(1)));
                    result.put("from", mr.group(2));
                    result.put("ttl", Integer.parseInt(mr.group(3)));
                    result.put("timeMs", Double.parseDouble(mr.group(4)));
                } else if (Pattern
                        .compile("unreachable|unknown host|bad address", Pattern.CASE_INSENSITIVE)
                        .matcher(raw).find()) {
                    result.put("status", "unreachable");
                } else {
                    result.put("status", "timeout");
                }

                call.resolve(result);
            } catch (Exception e) {
                call.reject("pingOnce falló: " + e.getMessage(), e);
            }
        }).start();
    }

    // -----------------------------------------------------------------------
    // traceHop — un solo salto de traceroute con un TTL fijo (modo "uno por
    // uno"; el bucle de TTL lo maneja JS). Misma lógica de parsing por-salto
    // que el método traceroute.
    // -----------------------------------------------------------------------
    @PluginMethod
    public void traceHop(PluginCall call) {
        final String host = call.getString("host");
        if (host == null || host.isEmpty()) {
            call.reject("host requerido");
            return;
        }
        final Integer ttlArg = call.getInt("ttl");
        if (ttlArg == null) {
            call.reject("ttl requerido");
            return;
        }
        final int ttl = ttlArg;
        final int timeoutSec = call.getInt("timeoutSec", 3);

        new Thread(() -> {
            try {
                long start = System.currentTimeMillis();
                Process p = new ProcessBuilder()
                    .command("/system/bin/ping",
                             "-c", "1",
                             "-W", String.valueOf(timeoutSec),
                             "-t", String.valueOf(ttl),
                             host)
                    .redirectErrorStream(true)
                    .start();
                String raw = readAll(p);
                p.waitFor();
                long elapsed = System.currentTimeMillis() - start;

                JSObject hop = new JSObject();
                hop.put("ttl", ttl);
                hop.put("raw", raw);

                Matcher mh = Pattern
                    .compile("From\\s+([\\d.]+).*?(Time to live exceeded|TTL exceeded)", Pattern.CASE_INSENSITIVE | Pattern.DOTALL)
                    .matcher(raw);
                if (mh.find()) {
                    hop.put("ip", mh.group(1));
                    hop.put("rttMs", (double) elapsed);
                    hop.put("status", "intermediate");
                } else {
                    Matcher me = Pattern
                        .compile("\\d+\\s+bytes\\s+from\\s+([\\d.]+).*?time[=<]([\\d.]+)\\s*ms", Pattern.DOTALL)
                        .matcher(raw);
                    if (me.find()) {
                        hop.put("ip", me.group(1));
                        hop.put("rttMs", Double.parseDouble(me.group(2)));
                        hop.put("status", "reached");
                    } else {
                        hop.put("status", "timeout");
                    }
                }

                call.resolve(hop);
            } catch (Exception e) {
                call.reject("traceHop falló: " + e.getMessage(), e);
            }
        }).start();
    }

    // -----------------------------------------------------------------------
    // getWifiInfo — requiere ACCESS_FINE_LOCATION desde Android 10
    // -----------------------------------------------------------------------
    @PluginMethod
    public void getWifiInfo(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "wifiInfoPermissionCallback");
            return;
        }
        respondWithWifiInfo(call);
    }

    @PermissionCallback
    private void wifiInfoPermissionCallback(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            respondWithWifiInfo(call);
        } else {
            call.reject("Permiso de ubicación denegado (requerido para SSID/RSSI en Android 10+)");
        }
    }

    private void respondWithWifiInfo(PluginCall call) {
        try {
            Context ctx = getContext().getApplicationContext();
            WifiManager wm = (WifiManager) ctx.getSystemService(Context.WIFI_SERVICE);
            if (wm == null) {
                call.reject("WifiManager no disponible");
                return;
            }
            WifiInfo info = wm.getConnectionInfo();
            JSObject r = new JSObject();

            String ssid = info.getSSID();
            if (ssid != null && ssid.startsWith("\"") && ssid.endsWith("\"")) {
                ssid = ssid.substring(1, ssid.length() - 1);
            }
            r.put("ssid", ssid);
            r.put("bssid", info.getBSSID());
            r.put("rssiDbm", info.getRssi());
            r.put("linkSpeedMbps", info.getLinkSpeed());
            r.put("frequencyMhz", info.getFrequency());
            r.put("ipAddress", intToIp(info.getIpAddress()));
            r.put("signalLevel", WifiManager.calculateSignalLevel(info.getRssi(), 5));
            // % de señal con fórmula estándar (RSSI a porcentaje, 0..100)
            int rssi = info.getRssi();
            int pct = Math.max(0, Math.min(100, 2 * (rssi + 100)));
            r.put("signalPercent", pct);

            // Banda derivada de la frecuencia (24/5/6 GHz)
            int freq = info.getFrequency();
            String band = freq >= 2400 && freq < 2500 ? "2.4 GHz"
                        : freq >= 5000 && freq < 5900 ? "5 GHz"
                        : freq >= 5950 && freq <= 7125 ? "6 GHz"
                        : null;
            r.put("band", band);

            // Estándar WiFi (n/ac/ax/be) — sólo en Android 11+ (API 30)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                int std = info.getWifiStandard();
                r.put("wifiStandard", std);
                r.put("wifiStandardName", standardName(std));
            }
            call.resolve(r);
        } catch (Exception e) {
            call.reject("getWifiInfo falló: " + e.getMessage(), e);
        }
    }

    // -----------------------------------------------------------------------
    // scanAccessPoints — escanea TODOS los APs visibles, no sólo el conectado.
    // Maneja el throttling de Android 9+: si startScan() devuelve false (límite
    // 4 scans / 2 min), devolvemos los resultados cacheados con fromCache=true.
    // -----------------------------------------------------------------------
    @PluginMethod
    public void scanAccessPoints(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "scanApPermissionCallback");
            return;
        }
        performScan(call);
    }

    @PermissionCallback
    private void scanApPermissionCallback(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            performScan(call);
        } else {
            call.reject("Permiso de ubicación denegado (requerido para WiFi scan).");
        }
    }

    private void performScan(final PluginCall call) {
        final Context ctx = getContext().getApplicationContext();
        final WifiManager wm = (WifiManager) ctx.getSystemService(Context.WIFI_SERVICE);
        if (wm == null) { call.reject("WifiManager no disponible"); return; }
        if (!wm.isWifiEnabled()) { call.reject("WiFi está desactivado en el dispositivo."); return; }

        final boolean[] done = { false };
        final BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (done[0]) return;
                done[0] = true;
                try { context.unregisterReceiver(this); } catch (Exception ignored) {}
                boolean ok = intent.getBooleanExtra(WifiManager.EXTRA_RESULTS_UPDATED, true);
                resolveScan(call, wm, !ok);
            }
        };

        IntentFilter filter = new IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                ctx.registerReceiver(receiver, filter);
            }
        } catch (Exception e) {
            call.reject("registerReceiver falló: " + e.getMessage());
            return;
        }

        boolean started;
        try {
            // startScan() está deprecado en API 28+ pero sigue siendo la forma
            // soportada de forzar un re-scan en apps de campo.
            started = wm.startScan();
        } catch (SecurityException se) {
            try { ctx.unregisterReceiver(receiver); } catch (Exception ignored) {}
            call.reject("SecurityException en startScan: " + se.getMessage());
            return;
        }

        if (!started) {
            // Throttling — devolvemos cache inmediatamente.
            done[0] = true;
            try { ctx.unregisterReceiver(receiver); } catch (Exception ignored) {}
            resolveScan(call, wm, true);
            return;
        }

        // Fallback: si en 10 s no llegó el broadcast (algunos OEMs no lo
        // disparan), devolvemos cache.
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (done[0]) return;
            done[0] = true;
            try { ctx.unregisterReceiver(receiver); } catch (Exception ignored) {}
            resolveScan(call, wm, true);
        }, 10000);
    }

    private void resolveScan(PluginCall call, WifiManager wm, boolean fromCache) {
        String connectedBssid = null;
        String connectedSsid = null;
        try {
            WifiInfo info = wm.getConnectionInfo();
            if (info != null) {
                connectedBssid = info.getBSSID();
                String s = info.getSSID();
                if (s != null && s.startsWith("\"") && s.endsWith("\"")) {
                    s = s.substring(1, s.length() - 1);
                }
                connectedSsid = s;
            }
        } catch (Exception ignored) {}

        List<ScanResult> results;
        try {
            results = wm.getScanResults();
        } catch (Exception e) {
            call.reject("getScanResults falló: " + e.getMessage());
            return;
        }

        JSONArray arr = new JSONArray();
        for (ScanResult r : results) {
            JSObject ap = new JSObject();
            ap.put("bssid", r.BSSID);
            ap.put("ssid", r.SSID);
            ap.put("signalDbm", r.level);
            ap.put("frequencyMhz", r.frequency);
            ap.put("band", bandFromFreq(r.frequency));
            ap.put("channel", channelFromFreq(r.frequency));
            ap.put("capabilities", r.capabilities);
            ap.put("isConnected", r.BSSID != null && r.BSSID.equalsIgnoreCase(connectedBssid));
            ap.put("timestampMs", r.timestamp);
            // Ancho de canal y frecuencias centrales (API 23+). Sin dato → 20 MHz.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                ap.put("channelWidthMhz", channelWidthMhz(r.channelWidth));
                ap.put("centerFreq0", r.centerFreq0);
                ap.put("centerFreq1", r.centerFreq1);
            } else {
                ap.put("channelWidthMhz", 20);
                ap.put("centerFreq0", JSONObject.NULL);
                ap.put("centerFreq1", JSONObject.NULL);
            }
            // Estándar WiFi del AP (API 30+).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                int std = r.getWifiStandard();
                ap.put("wifiStandard", std);
                ap.put("wifiStandardName", standardName(std));
            }
            arr.put(ap);
        }

        JSObject result = new JSObject();
        result.put("accessPoints", arr);
        result.put("fromCache", fromCache);
        result.put("connectedBssid", connectedBssid);
        result.put("connectedSsid", connectedSsid);
        result.put("scannedAt", System.currentTimeMillis());
        call.resolve(result);
    }

    private String bandFromFreq(int freq) {
        if (freq >= 2400 && freq < 2500) return "2.4GHz";
        if (freq >= 5000 && freq < 5900) return "5GHz";
        if (freq >= 5950 && freq <= 7125) return "6GHz";
        return "unknown";
    }

    private int channelFromFreq(int freq) {
        if (freq >= 2412 && freq <= 2484) return (freq - 2407) / 5;
        // 5 GHz hasta 5885 (canal 177, UNII-4).
        if (freq >= 5180 && freq <= 5885) return (freq - 5000) / 5;
        if (freq >= 5955 && freq <= 7115) return (freq - 5955) / 5 + 1;
        return -1;
    }

    /** ScanResult.CHANNEL_WIDTH_* → MHz (80+80 cuenta como 160). */
    private static int channelWidthMhz(int w) {
        switch (w) {
            case 0: return 20;   // CHANNEL_WIDTH_20MHZ
            case 1: return 40;   // CHANNEL_WIDTH_40MHZ
            case 2: return 80;   // CHANNEL_WIDTH_80MHZ
            case 3: return 160;  // CHANNEL_WIDTH_160MHZ
            case 4: return 160;  // CHANNEL_WIDTH_80MHZ_PLUS_MHZ
            case 5: return Build.VERSION.SDK_INT >= 33 ? 320 : 20; // CHANNEL_WIDTH_320MHZ (API 33)
            default: return 20;
        }
    }

    private String standardName(int std) {
        // Constantes de ScanResult.WIFI_STANDARD_* (API 30+)
        switch (std) {
            case 1: return "802.11 legacy";
            case 4: return "802.11n (Wi-Fi 4)";
            case 5: return "802.11ac (Wi-Fi 5)";
            case 6: return "802.11ax (Wi-Fi 6)";
            case 7: return "802.11ad";
            case 8: return "802.11be (Wi-Fi 7)";
            default: return "Desconocido";
        }
    }

    private String intToIp(int ip) {
        if (ip == 0) return null;
        return (ip & 0xFF) + "." + ((ip >> 8) & 0xFF) + "."
             + ((ip >> 16) & 0xFF) + "." + ((ip >> 24) & 0xFF);
    }

    // =======================================================================
    // RED INTERNA — getNetConfig, tcpPing, sweepSubnet, probeHosts,
    // discoverNetwork. Port de netprobe.js / discovery.js de Wifix Remote
    // (motor Node) a sockets Java; la lógica de sockets vive en LanEngine y la
    // lógica pura (paquetes y parsers) en LanParsers.
    //
    // Todo corre en lanExecutor (nunca en el hilo UI) y con los sockets
    // bindeados a la Network WiFi cuando existe.
    // =======================================================================

    private static final String LAN_TAG = "WifixLan";
    private static final int[] DEFAULT_TCPPING_PORTS = { 80, 443, 22, 445, 7, 8080, 53, 139 };
    private static final int[] DEFAULT_SWEEP_PORTS = { 80, 443, 22, 445, 139, 53, 8080, 7, 9100, 62078 };

    private final ExecutorService lanExecutor = Executors.newCachedThreadPool();

    @Override
    protected void handleOnDestroy() {
        lanExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    private interface LanTask {
        void run() throws Exception;
    }

    /** Ejecuta fuera del hilo UI; cualquier excepción termina en reject (nunca crash). */
    private void runLan(final PluginCall call, final String what, final LanTask task) {
        try {
            lanExecutor.execute(() -> {
                try {
                    task.run();
                } catch (Throwable t) {
                    Log.w(LAN_TAG, what + " falló", t);
                    String msg = t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName();
                    call.reject(what + " falló: " + msg);
                }
            });
        } catch (RejectedExecutionException e) {
            call.reject(what + " no disponible: el plugin se está cerrando.");
        }
    }

    private static Object nz(Object v) {
        return v == null ? JSONObject.NULL : v;
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }

    private static int[] readPorts(PluginCall call, String key, int[] def) {
        JSONArray arr = call.getArray(key);
        if (arr == null || arr.length() == 0) return def;
        List<Integer> out = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            int p = arr.optInt(i, -1);
            if (p >= 1 && p <= 65535 && !out.contains(p)) out.add(p);
        }
        if (out.isEmpty()) return def;
        int[] r = new int[out.size()];
        for (int i = 0; i < r.length; i++) r[i] = out.get(i);
        return r;
    }

    private static JSONArray intArray(List<Integer> v) {
        JSONArray a = new JSONArray();
        if (v != null) for (Integer i : v) a.put((Object) i);
        return a;
    }

    /** Forma `stat` de netprobe.js:88-118 (nulls explícitos). */
    private static JSObject statToJs(LanParsers.Stat s) {
        JSObject o = new JSObject();
        o.put("avg", nz(s.avg));
        o.put("min", nz(s.min));
        o.put("max", nz(s.max));
        o.put("time", nz(s.time));
        o.put("packetLoss", nz(s.packetLoss));
        o.put("stddev", nz(s.stddev));
        o.put("sent", s.sent);
        o.put("received", s.received);
        JSONArray samples = new JSONArray();
        for (double d : s.samples) samples.put((Object) Double.valueOf(d));
        o.put("samples", samples);
        return o;
    }

    // ---- Configuración de red WiFi ----------------------------------------

    private static final class NetConfig {
        Network network;
        String deviceIp;
        String gatewayIp;
        Integer prefixLength;
        List<String> dns = new ArrayList<>();
        String interfaceName;
        String source;
    }

    @SuppressWarnings("deprecation")
    private static Network findWifiNetwork(ConnectivityManager cm) {
        if (cm == null) return null;
        try {
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities nc = cm.getNetworkCapabilities(n);
                if (nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return n;
            }
        } catch (Exception e) {
            Log.w(LAN_TAG, "findWifiNetwork: " + e);
        }
        return null;
    }

    @SuppressWarnings("deprecation")
    private NetConfig resolveNetConfig() {
        Context ctx = getContext().getApplicationContext();
        NetConfig cfg = new NetConfig();
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        Network wifi = findWifiNetwork(cm);
        if (wifi != null) {
            cfg.network = wifi;
            LinkProperties lp = null;
            try { lp = cm.getLinkProperties(wifi); } catch (Exception ignored) {}
            if (lp != null) {
                cfg.interfaceName = lp.getInterfaceName();
                for (LinkAddress la : lp.getLinkAddresses()) {
                    if (la.getAddress() instanceof Inet4Address) {
                        cfg.deviceIp = la.getAddress().getHostAddress();
                        cfg.prefixLength = la.getPrefixLength();
                        break;
                    }
                }
                for (RouteInfo r : lp.getRoutes()) {
                    InetAddress g = r.getGateway();
                    if (r.isDefaultRoute() && g instanceof Inet4Address && !g.isAnyLocalAddress()) {
                        cfg.gatewayIp = g.getHostAddress();
                        break;
                    }
                }
                for (InetAddress d : lp.getDnsServers()) {
                    if (d != null) cfg.dns.add(d.getHostAddress());
                }
                cfg.source = "linkProperties";
            }
        }
        // Respaldo: DhcpInfo para lo que LinkProperties no dio.
        if (cfg.deviceIp == null || cfg.gatewayIp == null || cfg.prefixLength == null || cfg.dns.isEmpty()) {
            try {
                WifiManager wm = (WifiManager) ctx.getSystemService(Context.WIFI_SERVICE);
                DhcpInfo di = wm != null ? wm.getDhcpInfo() : null;
                if (di != null && di.ipAddress != 0) {
                    boolean used = false;
                    if (cfg.deviceIp == null) { cfg.deviceIp = intToIp(di.ipAddress); used = true; }
                    if (cfg.gatewayIp == null && di.gateway != 0) { cfg.gatewayIp = intToIp(di.gateway); used = true; }
                    if (cfg.prefixLength == null) {
                        int p = LanParsers.prefixFromDhcpNetmask(di.netmask);
                        if (p > 0) { cfg.prefixLength = p; used = true; }
                    }
                    if (cfg.dns.isEmpty()) {
                        if (di.dns1 != 0) { cfg.dns.add(intToIp(di.dns1)); used = true; }
                        if (di.dns2 != 0) { cfg.dns.add(intToIp(di.dns2)); used = true; }
                    }
                    if (used) cfg.source = cfg.source == null ? "dhcpInfo" : cfg.source + "+dhcpInfo";
                }
            } catch (Exception e) {
                Log.w(LAN_TAG, "getDhcpInfo: " + e);
            }
        }
        return cfg;
    }

    private LanEngine.Ctx buildCtx(NetConfig cfg) {
        NetworkInterface iface = null;
        Inet4Address local = null;
        try {
            if (cfg.deviceIp != null) {
                InetAddress a = InetAddress.getByName(cfg.deviceIp);
                if (a instanceof Inet4Address) local = (Inet4Address) a;
            }
        } catch (Exception ignored) {}
        try {
            if (cfg.interfaceName != null) iface = NetworkInterface.getByName(cfg.interfaceName);
            if (iface == null && local != null) iface = NetworkInterface.getByInetAddress(local);
        } catch (Exception ignored) {}
        return new LanEngine.Ctx(cfg.network, iface, local, lanExecutor);
    }

    private static final String NO_WIFI_MSG =
        "No hay conexión WiFi activa: conéctese a la red del cliente y reintente.";

    // -----------------------------------------------------------------------
    // getNetConfig() → { deviceIp, gatewayIp, prefixLength, netmask, dns[] }
    // -----------------------------------------------------------------------
    @PluginMethod
    public void getNetConfig(PluginCall call) {
        runLan(call, "getNetConfig", () -> {
            NetConfig cfg = resolveNetConfig();
            if (cfg.deviceIp == null) {
                call.reject(NO_WIFI_MSG);
                return;
            }
            JSObject r = new JSObject();
            r.put("deviceIp", cfg.deviceIp);
            r.put("gatewayIp", nz(cfg.gatewayIp));
            r.put("prefixLength", nz(cfg.prefixLength));
            r.put("netmask", nz(cfg.prefixLength != null ? LanParsers.netmaskFromPrefix(cfg.prefixLength) : null));
            JSONArray dns = new JSONArray();
            for (String d : cfg.dns) dns.put(d);
            r.put("dns", dns);
            r.put("interfaceName", nz(cfg.interfaceName));
            r.put("source", nz(cfg.source));
            call.resolve(r);
        });
    }

    // -----------------------------------------------------------------------
    // tcpPing({ host, ports[], count, timeoutMs }) — tcpPingHost de netprobe.
    // Devuelve los campos de `stat` en la raíz + { stat, respondsTcp,
    // openPort, openPorts }.
    // -----------------------------------------------------------------------
    @PluginMethod
    public void tcpPing(PluginCall call) {
        final String host = call.getString("host");
        if (host == null || host.trim().isEmpty()) {
            call.reject("host requerido");
            return;
        }
        final int[] ports = readPorts(call, "ports", DEFAULT_TCPPING_PORTS);
        final int count = clamp(call.getInt("count", 4), 1, 100);
        final int timeoutMs = clamp(call.getInt("timeoutMs", 1500), 50, 30000);
        final int probeTimeoutMs = clamp(call.getInt("probeTimeoutMs", 800), 50, 30000);
        runLan(call, "tcpPing", () -> {
            Network net = resolveNetConfig().network;
            LanEngine.HostPing hp = LanEngine.tcpPingHost(host.trim(), ports, count, timeoutMs, probeTimeoutMs, net);
            JSObject stat = statToJs(hp.stat);
            JSObject r = new JSObject();
            java.util.Iterator<String> keys = stat.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                r.put(k, stat.opt(k));
            }
            r.put("stat", stat);
            r.put("respondsTcp", hp.respondsTcp);
            r.put("openPort", nz(hp.openPort));
            r.put("openPorts", intArray(hp.openPorts));
            r.put("host", host.trim());
            call.resolve(r);
        });
    }

    // -----------------------------------------------------------------------
    // sweepSubnet({ ports, timeoutMs=600, batchSize=32 }) → { alive:[...] }
    // Barre la /24 de la IP local; emite 'lanProgress' {phase,done,total}.
    // -----------------------------------------------------------------------
    @PluginMethod
    public void sweepSubnet(PluginCall call) {
        final int[] ports = readPorts(call, "ports", DEFAULT_SWEEP_PORTS);
        final int timeoutMs = clamp(call.getInt("timeoutMs", 600), 50, 10000);
        // Tope 64: 64 IPs × 10 puertos = 640 sockets simultáneos como máximo.
        final int batchSize = clamp(call.getInt("batchSize", 32), 1, 64);
        final String ipArg = call.getString("deviceIp");
        runLan(call, "sweepSubnet", () -> {
            NetConfig cfg = resolveNetConfig();
            String base = (ipArg != null && !ipArg.isEmpty()) ? ipArg : cfg.deviceIp;
            if (base == null) {
                call.reject(NO_WIFI_MSG);
                return;
            }
            String prefix = LanParsers.slash24Prefix(base);
            if (prefix == null) {
                call.reject("IP local inválida para el barrido: " + base);
                return;
            }
            long t0 = System.currentTimeMillis();
            List<LanEngine.SweepHit> hits = LanEngine.sweepSubnet(prefix, ports, timeoutMs, batchSize, cfg.network,
                (done, total) -> {
                    JSObject p = new JSObject();
                    p.put("phase", "sweep");
                    p.put("done", done);
                    p.put("total", total);
                    notifyListeners("lanProgress", p);
                });
            JSONArray alive = new JSONArray();
            for (LanEngine.SweepHit h : hits) {
                JSObject o = new JSObject();
                o.put("ip", h.ip);
                o.put("rttMs", Double.isInfinite(h.rttMs) ? JSONObject.NULL : (Object) LanParsers.r1(h.rttMs));
                o.put("openPorts", intArray(h.openPorts));
                o.put("respondsTcp", true);
                alive.put(o);
            }
            JSObject r = new JSObject();
            r.put("alive", alive);
            r.put("subnet", prefix + "0/24");
            r.put("durationMs", System.currentTimeMillis() - t0);
            call.resolve(r);
        });
    }

    // -----------------------------------------------------------------------
    // probeHosts({ hosts:[ip], gatewayIp }) → { results:[...] } en lotes de 6.
    // Por IP en paralelo: tcpPing, mDNS PTR, NetBIOS, PTR unicast al gateway
    // y (si hay puerto web y falta nombre/tipo) banner HTTP.
    // -----------------------------------------------------------------------
    @PluginMethod
    public void probeHosts(PluginCall call) {
        JSONArray arr = call.getArray("hosts");
        final List<String> hosts = new ArrayList<>();
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                String h = arr.optString(i, null);
                if (h != null && !h.trim().isEmpty() && !hosts.contains(h.trim())) hosts.add(h.trim());
            }
        }
        if (hosts.isEmpty()) {
            call.reject("hosts requerido (lista de IPs)");
            return;
        }
        final String gwArg = call.getString("gatewayIp");
        runLan(call, "probeHosts", () -> {
            NetConfig cfg = resolveNetConfig();
            final String gw = (gwArg != null && !gwArg.isEmpty()) ? gwArg : cfg.gatewayIp;
            final LanEngine.Ctx ctx = buildCtx(cfg);
            final int total = hosts.size();
            final int BATCH = 6;
            JSONArray results = new JSONArray();
            for (int i = 0; i < total; i += BATCH) {
                List<Future<LanEngine.ProbeResult>> fs = new ArrayList<>();
                List<String> slice = hosts.subList(i, Math.min(total, i + BATCH));
                for (final String ip : slice) {
                    fs.add(lanExecutor.submit(() -> LanEngine.probeHost(ip, gw, ctx)));
                }
                for (int k = 0; k < fs.size(); k++) {
                    LanEngine.ProbeResult pr = LanEngine.getOr(fs.get(k), 30000, null);
                    results.put(probeToJs(slice.get(k), pr));
                }
                JSObject p = new JSObject();
                p.put("phase", "probe");
                p.put("done", Math.min(total, i + BATCH));
                p.put("total", total);
                notifyListeners("lanProgress", p);
            }
            JSObject r = new JSObject();
            r.put("results", results);
            call.resolve(r);
        });
    }

    private static JSObject probeToJs(String ip, LanEngine.ProbeResult pr) {
        JSObject o = new JSObject();
        o.put("ip", ip);
        LanEngine.HostPing hp = pr != null ? pr.ping : null;
        if (hp == null) {
            hp = new LanEngine.HostPing();
            hp.stat = LanParsers.noResponseStat();
        }
        o.put("openPorts", intArray(hp.openPorts));
        o.put("openPort", nz(hp.openPort));
        o.put("respondsTcp", hp.respondsTcp);
        o.put("stat", statToJs(hp.stat));
        o.put("mdnsName", nz(pr != null ? pr.mdnsName : null));
        o.put("netbiosName", nz(pr != null ? pr.netbiosName : null));
        o.put("netbiosMac", nz(pr != null ? pr.netbiosMac : null));
        o.put("ptrName", nz(pr != null ? pr.ptrName : null));
        if (pr != null && pr.banner != null) {
            JSObject b = new JSObject();
            b.put("server", nz(pr.banner.server));
            b.put("realm", nz(pr.banner.realm));
            b.put("title", nz(pr.banner.title));
            o.put("banner", b);
        } else {
            o.put("banner", JSONObject.NULL);
        }
        return o;
    }

    // -----------------------------------------------------------------------
    // discoverNetwork({ mdnsMs=6000, ssdpMs=6000 }) →
    //   { [ip]: { name, type, source, manufacturer, model } }
    // Adquiere y libera el MulticastLock dentro del método.
    // -----------------------------------------------------------------------
    @PluginMethod
    public void discoverNetwork(PluginCall call) {
        final int mdnsMs = clamp(call.getInt("mdnsMs", call.getInt("mdnsTimeoutMs", 6000)), 500, 30000);
        final int ssdpMs = clamp(call.getInt("ssdpMs", call.getInt("ssdpTimeoutMs", 6000)), 500, 30000);
        runLan(call, "discoverNetwork", () -> {
            NetConfig cfg = resolveNetConfig();
            if (cfg.deviceIp == null) {
                call.reject(NO_WIFI_MSG);
                return;
            }
            LanEngine.Ctx ctx = buildCtx(cfg);
            WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiManager.MulticastLock lock = null;
            Map<String, LanParsers.Device> found;
            try {
                if (wm != null) {
                    try {
                        lock = wm.createMulticastLock("wifix-lan-discovery");
                        lock.setReferenceCounted(false);
                        lock.acquire();
                    } catch (Exception e) {
                        Log.w(LAN_TAG, "MulticastLock no disponible: " + e);
                        lock = null;
                    }
                }
                found = LanEngine.discoverNetwork(mdnsMs, ssdpMs, ctx);
            } finally {
                if (lock != null) {
                    try { if (lock.isHeld()) lock.release(); } catch (Exception ignored) {}
                }
            }
            JSObject r = new JSObject();
            for (Map.Entry<String, LanParsers.Device> e : found.entrySet()) {
                LanParsers.Device d = e.getValue();
                JSObject o = new JSObject();
                o.put("name", nz(d.name));
                o.put("type", nz(d.type));
                o.put("source", nz(d.source));
                o.put("manufacturer", nz(d.manufacturer));
                o.put("model", nz(d.model));
                r.put(e.getKey(), o);
            }
            call.resolve(r);
        });
    }

    // =======================================================================
    // SPEEDTEST — HTTP nativo (sin CORS, ancho de banda real).
    // El discovery (lista de servers Ookla) lo sigue haciendo JS vía
    // CapacitorHttp; aquí van ping/latencia/download/upload contra el server
    // elegido. Todo usa HttpURLConnection (sin dependencias extra).
    // =======================================================================

    private static final String SPEEDTEST_UA =
        "Mozilla/5.0 (Android) WifixSpeedtest/1.0";

    /** Redirecciones que seguimos a mano (ver openGetFollowing). */
    private static final int MAX_REDIRECTS = 5;

    /** Primer tramo del test que NO se promedia: TCP slow-start / ramp-up. */
    private static final int RAMP_UP_MS = 1500;

    /**
     * Techo físico de una medición creíble desde un teléfono por WiFi.
     * Ni Wi-Fi 6E sobre un plan residencial pasa de aquí: cualquier muestra
     * por encima es un artefacto de medición (bytes contados que nunca
     * transitaron) y se descarta en vez de promediarse.
     */
    private static final double MAX_PLAUSIBLE_MBPS = 2500.0;

    // -----------------------------------------------------------------------
    // httpPing — N descargas de un asset chico; descarta la 1ª (warm-up),
    // mide tiempo de respuesta completa. Sirve para ping a candidatos y para
    // latencia precisa (con más muestras). Devuelve avgMs, minMs, jitterMs,
    // packetLossPercent, samples[] y ok.
    // -----------------------------------------------------------------------
    @PluginMethod
    public void httpPing(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url requerida");
            return;
        }
        final int samples = Math.max(1, call.getInt("samples", 4));

        new Thread(() -> {
            try {
                java.util.ArrayList<Double> times = new java.util.ArrayList<>();
                int lost = 0;
                // samples + 1: la primera es warm-up y se descarta.
                int total = samples + 1;
                for (int i = 0; i < total; i++) {
                    long t0 = System.nanoTime();
                    boolean ok = drainGet(url, i);
                    double ms = (System.nanoTime() - t0) / 1e6;
                    if (i == 0) continue; // warm-up
                    if (ok) times.add(ms);
                    else lost++;
                }

                JSObject result = new JSObject();
                JSONArray arr = new JSONArray();
                double sum = 0, min = Double.MAX_VALUE;
                for (double t : times) { arr.put(t); sum += t; if (t < min) min = t; }
                double avg = times.isEmpty() ? 0 : sum / times.size();
                double jitter = 0;
                if (times.size() > 1) {
                    double v = 0;
                    for (double t : times) v += (t - avg) * (t - avg);
                    jitter = Math.sqrt(v / times.size());
                }
                double packetLoss = (lost / (double) samples) * 100.0;

                result.put("ok", !times.isEmpty());
                result.put("avgMs", times.isEmpty() ? null : avg);
                result.put("minMs", times.isEmpty() ? null : min);
                result.put("jitterMs", jitter);
                result.put("packetLossPercent", packetLoss);
                result.put("samples", arr);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("httpPing falló: " + e.getMessage(), e);
            }
        }).start();
    }

    // -----------------------------------------------------------------------
    // downloadTest — N hilos descargan url en bucle (Cloudflare __down devuelve
    // exactamente ?bytes=N) acumulando los bytes REALMENTE leídos del socket en
    // un AtomicLong. Corta a minMs (tope maxMs). Emite progreso cada ~300ms con
    // mbps de ventana móvil de ~2s. Verifica que el código sea 200 antes de
    // contar; si no, loguea y reintenta. Captura cf-meta-colo si viene.
    //
    // Tres correcciones sobre la versión anterior:
    //  1) Sigue redirecciones a mano (openGetFollowing): el 307 de los
    //     servidores Ookla ya no aborta la fase.
    //  2) Reintenta con BACKOFF exponencial y abandona el stream tras varios
    //     fallos seguidos: antes martillaba el endpoint cada 150 ms durante
    //     15 s, lo que se ganaba el 429 de Cloudflare en el fallback.
    //  3) El mbps final se calcula sobre la ventana POSTERIOR al ramp-up
    //     (RAMP_UP_MS), no sobre todo el test: el TCP slow-start de los
    //     primeros ~1.5 s ya no arrastra el promedio hacia abajo.
    // -----------------------------------------------------------------------
    @PluginMethod
    public void downloadTest(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url requerida");
            return;
        }
        final int parallel = Math.max(1, call.getInt("parallelStreams", 6));
        final int minMs = call.getInt("minMs", 15000);
        final int maxMs = call.getInt("maxMs", 22000);

        new Thread(() -> {
            try {
                final AtomicLong bytes = new AtomicLong(0);
                final AtomicBoolean abort = new AtomicBoolean(false);
                final long start = System.currentTimeMillis();
                final String[] colo = { null };
                // --- Diagnóstico: dejar de fallar en silencio ---
                // Primer código HTTP != 200 visto por cualquier stream (-1 = nunca
                // hubo respuesta / siempre excepción). Última excepción (string).
                // Total de reintentos por código != 200 entre todos los streams.
                final AtomicInteger firstBadCode = new AtomicInteger(-1);
                final AtomicInteger streamRetries = new AtomicInteger(0);
                final String[] lastError = { null };
                // Streams todavía vivos: cuando llegan a 0 (endpoint roto,
                // 429 sostenido…) el reporter corta en vez de esperar 15 s.
                final AtomicInteger liveStreams = new AtomicInteger(parallel);
                // Streams que se rindieron por fallos (no por fin del test).
                final AtomicInteger gaveUp = new AtomicInteger(0);
                // Fallos seguidos tolerados por stream antes de abandonarlo.
                final int MAX_STREAM_FAILURES = 4;

                Thread[] workers = new Thread[parallel];
                for (int i = 0; i < parallel; i++) {
                    final int idx = i;
                    workers[i] = new Thread(() -> {
                        byte[] buf = new byte[64 * 1024];
                        long streamBytes = 0;
                        int failures = 0;
                        // El stream se abandona tras MAX_STREAM_FAILURES fallos
                        // seguidos (endpoint muerto / rate-limit sostenido).
                        while (!abort.get() && failures < MAX_STREAM_FAILURES) {
                            HttpURLConnection conn = null;
                            // reusable=true sólo cuando leímos el body COMPLETO hasta
                            // EOF (-1): ese socket vuelve al pool de keep-alive y el
                            // siguiente GET lo reutiliza sin re-handshake TCP+TLS.
                            // Si salimos por abort a mitad de body, por código != 200
                            // o por excepción, el socket NO es reutilizable → disconnect.
                            boolean reusable = false;
                            try {
                                // openGetFollowing: resuelve 301/302/307/308
                                // (incluido el salto http↔https que
                                // HttpURLConnection se niega a seguir).
                                conn = openGetFollowing(url + (url.contains("?") ? "&" : "?")
                                        + "n=" + Math.random());
                                int code = conn.getResponseCode();
                                if (code != 200) {
                                    android.util.Log.w("WifixSpeedtest",
                                        "download stream " + idx + " código != 200: " + code);
                                    firstBadCode.compareAndSet(-1, code);
                                    streamRetries.incrementAndGet();
                                    failures++;
                                    try { drainError(conn); } catch (Exception ignored) {}
                                    conn.disconnect();
                                    conn = null;
                                    // Backoff creciente: martillar un endpoint que
                                    // devuelve 429/307 sólo empeora el rate-limit.
                                    if (failures < MAX_STREAM_FAILURES) backoffSleep(failures);
                                    continue;
                                }
                                failures = 0;
                                if (colo[0] == null) {
                                    String c = readColo(conn);
                                    if (c != null) colo[0] = c;
                                }
                                InputStream in = conn.getInputStream();
                                int n;
                                // Salimos del while por dos motivos: (a) n == -1 (EOF,
                                // body completo) o (b) abort.get() == true (corte a
                                // mitad de body). Distinguirlos define si reutilizamos.
                                while (!abort.get() && (n = in.read(buf)) != -1) {
                                    bytes.addAndGet(n);
                                    streamBytes += n;
                                }
                                // Si NO abortamos, el while terminó por EOF: el body
                                // de 25 MB se leyó entero → socket reutilizable.
                                reusable = !abort.get();
                                if (reusable) {
                                    // Camino normal: cerrar el stream devuelve el socket
                                    // al pool de keep-alive. NO desconectar.
                                    in.close();
                                } else {
                                    // Abortamos a mitad de body: socket inservible.
                                    try { in.close(); } catch (Exception ignored) {}
                                }
                            } catch (Exception e) {
                                android.util.Log.w("WifixSpeedtest",
                                    "download stream " + idx + " excepción: " + e.getMessage());
                                lastError[0] = e.getMessage();
                                failures++;
                                // El finally de abajo desconecta el socket roto.
                                if (failures < MAX_STREAM_FAILURES) backoffSleep(failures);
                            } finally {
                                // Sólo desconectar si el socket NO quedó reutilizable
                                // (abort a medias, excepción). En el camino EOF se omite
                                // a propósito para preservar keep-alive y eliminar los
                                // huecos de reconexión que hacían caer el display en vivo.
                                if (conn != null && !reusable) conn.disconnect();
                            }
                        }
                        if (failures >= MAX_STREAM_FAILURES) gaveUp.incrementAndGet();
                        liveStreams.decrementAndGet();
                        android.util.Log.i("WifixSpeedtest",
                            "download stream " + idx + " bytes=" + streamBytes
                            + " failures=" + failures);
                    });
                    workers[i].start();
                }

                long[] ramp = runReporter("download", bytes, abort, start, minMs, maxMs, liveStreams);

                for (Thread w : workers) { try { w.join(2000); } catch (Exception ignored) {} }

                long endMs = System.currentTimeMillis();
                long elapsed = endMs - start;
                long total = bytes.get();

                // mbps sobre la ventana estable (post ramp-up). Si el test cortó
                // antes del ramp-up (endpoint muerto) se usa todo el intervalo.
                long winMs = ramp[0] > 0 ? endMs - ramp[0] : elapsed;
                long winBytes = ramp[0] > 0 ? total - ramp[1] : total;
                if (winMs < 1000) { winMs = elapsed; winBytes = total; }
                double mbps = winMs > 0 ? (winBytes * 8.0) / (winMs / 1000.0) / 1e6 : 0;
                android.util.Log.i("WifixSpeedtest",
                    "download total bytes=" + total + " elapsedMs=" + elapsed
                    + " winBytes=" + winBytes + " winMs=" + winMs + " mbps=" + mbps
                    + " firstHttpCode=" + firstBadCode.get()
                    + " streamRetries=" + streamRetries.get()
                    + " lastError=" + lastError[0]);

                JSObject result = new JSObject();
                result.put("downloadMbps", mbps);
                result.put("downloadBytes", total);
                result.put("downloadElapsedMs", elapsed);
                if (colo[0] != null) result.put("colo", colo[0]);
                // Campos de diagnóstico (siempre presentes).
                result.put("downloadFirstHttpCode", firstBadCode.get());
                result.put("downloadLastError", lastError[0]);
                result.put("downloadStreamRetries", streamRetries.get());
                result.put("downloadWindowMs", winMs);
                result.put("downloadWindowBytes", winBytes);
                result.put("downloadStreamsGaveUp", gaveUp.get());
                call.resolve(result);
            } catch (Exception e) {
                call.reject("downloadTest falló: " + e.getMessage(), e);
            }
        }).start();
    }

    // -----------------------------------------------------------------------
    // uploadTest — N hilos hacen POST por REQUEST COMPLETO y sólo cuentan los
    // bytes que el servidor CONFIRMÓ haber recibido.
    //
    // FIX del bug de ~7000 Mbps: la versión anterior escribía de forma continua
    // y sumaba cada bloque apenas out.write() retornaba, sin mirar nunca el
    // código de respuesta. Dos formas de mentir tenía eso:
    //   (a) write() retorna cuando el bloque entra al buffer de envío (kernel /
    //       sink de OkHttp), no cuando sale por la red;
    //   (b) si el servidor cortaba temprano (307 a https, 405, 413…) los bytes
    //       escritos se seguían contando como "subidos" aunque la request
    //       hubiera fallado — de ahí las lecturas físicamente imposibles.
    //
    // Ahora cada iteración sube un payload de tamaño FIJO conocido y:
    //   - mide desde el primer write hasta que llega la respuesta del servidor
    //     (la respuesta sólo llega cuando el server leyó el cuerpo entero);
    //   - descarta la muestra si el código no es 2xx, si quedó incompleta o si
    //     da más de MAX_PLAUSIBLE_MBPS;
    //   - descarta la PRIMERA muestra de cada stream (TCP slow-start);
    //   - adapta el tamaño del payload para que cada request dure ~2 s, así
    //     satura tanto un plan de 10 Mbps como uno de 1 Gbps;
    //   - si el server responde 3xx con Location, se muda a esa URL en vez de
    //     seguir subiendo al vacío.
    // El agregado final = bytes confirmados / ventana real cubierta por las
    // muestras válidas (los streams corren en paralelo y se solapan).
    // -----------------------------------------------------------------------
    @PluginMethod
    public void uploadTest(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url requerida");
            return;
        }
        final int parallel = Math.max(1, call.getInt("parallelStreams", 4));
        final int minMs = call.getInt("minMs", 15000);
        final int maxMs = call.getInt("maxMs", 22000);

        new Thread(() -> {
            try {
                // Bloque pseudo-random de 64 KB reusado en cada write (no se
                // comprime al vuelo y no malgasta RAM).
                final int BLOCK = 64 * 1024;
                final byte[] block = new byte[BLOCK];
                for (int i = 0; i < BLOCK; i++) block[i] = (byte) ((i * 137) & 0xff);

                // Tamaños de payload por request: arranca chico (warm-up) y se
                // ajusta para durar ~2 s por request.
                final long FIRST_PAYLOAD = 1L * 1024 * 1024;
                final long MIN_PAYLOAD = 256L * 1024;
                final long MAX_PAYLOAD = 32L * 1024 * 1024;
                final double TARGET_REQ_MS = 2000.0;
                final int MAX_STREAM_FAILURES = 4;

                // bytes = SÓLO lo confirmado con 2xx (alimenta también el
                // medidor en vivo: preferimos un gauge honesto y escalonado a
                // uno suave y mentiroso).
                final AtomicLong bytes = new AtomicLong(0);
                final AtomicBoolean abort = new AtomicBoolean(false);
                final AtomicInteger liveStreams = new AtomicInteger(parallel);
                final AtomicInteger gaveUp = new AtomicInteger(0);
                final AtomicInteger samples = new AtomicInteger(0);
                final AtomicInteger discardedImplausible = new AtomicInteger(0);
                final AtomicInteger discardedHttp = new AtomicInteger(0);
                final AtomicInteger firstBadCode = new AtomicInteger(-1);
                final String[] lastError = { null };
                // Ventana cubierta por las muestras válidas, en ns desde startNs.
                final AtomicLong firstSampleNs = new AtomicLong(Long.MAX_VALUE);
                final AtomicLong lastSampleNs = new AtomicLong(0);

                final long start = System.currentTimeMillis();
                final long startNs = System.nanoTime();

                Thread[] workers = new Thread[parallel];
                for (int i = 0; i < parallel; i++) {
                    final int idx = i;
                    workers[i] = new Thread(() -> {
                        long streamBytes = 0;
                        long payload = FIRST_PAYLOAD;
                        boolean warmupDone = false;
                        int failures = 0;
                        String target = url;
                        while (!abort.get() && failures < MAX_STREAM_FAILURES) {
                            HttpURLConnection conn = null;
                            int code = -1;
                            // reusable: la request terminó limpia (2xx + body
                            // drenado) → el socket vuelve al pool de keep-alive y
                            // la siguiente no paga handshake. Sin esto, el hueco
                            // de reconexión cae DENTRO de la ventana medida y
                            // subestima la subida.
                            boolean reusable = false;
                            try {
                                URL u = new URL(target + (target.contains("?") ? "&" : "?")
                                        + "n=" + Math.random());
                                conn = (HttpURLConnection) u.openConnection();
                                conn.setConnectTimeout(8000);
                                conn.setReadTimeout(30000);
                                conn.setUseCaches(false);
                                conn.setDoOutput(true);
                                conn.setRequestMethod("POST");
                                conn.setRequestProperty("Content-Type", "application/octet-stream");
                                conn.setRequestProperty("User-Agent", SPEEDTEST_UA);
                                // Longitud fija: el servidor sabe cuánto esperar y
                                // responde recién cuando leyó todo → el tiempo hasta
                                // la respuesta ES el tiempo de tránsito.
                                conn.setFixedLengthStreamingMode(payload);

                                OutputStream out = conn.getOutputStream();
                                final long t0 = System.nanoTime();
                                long written = 0;
                                while (written < payload && !abort.get()) {
                                    int n = (int) Math.min(BLOCK, payload - written);
                                    out.write(block, 0, n);
                                    written += n;
                                }
                                final boolean complete = (written == payload);
                                try { out.flush(); } catch (Exception ignored) {}
                                // Con longitud fija, cerrar a mitad de cuerpo lanza:
                                // esa muestra se descarta igual (complete == false).
                                try { out.close(); } catch (Exception ignored) {}

                                if (!complete) break;   // abortamos a mitad: no hay muestra

                                code = conn.getResponseCode();
                                final long t1 = System.nanoTime();
                                drainBody(conn, code);

                                if (code >= 300 && code < 400) {
                                    // Redirección del POST (típico http→https): no se
                                    // cuenta y nos mudamos al destino real.
                                    String loc = conn.getHeaderField("Location");
                                    firstBadCode.compareAndSet(-1, code);
                                    discardedHttp.incrementAndGet();
                                    failures++;
                                    if (loc != null && !loc.isEmpty()) {
                                        target = new URL(new URL(target), loc).toString();
                                        failures--;   // mudarse no es un fallo del enlace
                                    }
                                    if (failures > 0) backoffSleep(failures);
                                    continue;
                                }
                                if (code < 200 || code >= 300) {
                                    // 4xx/5xx: el servidor NO recibió/aceptó el cuerpo.
                                    android.util.Log.w("WifixSpeedtest",
                                        "upload stream " + idx + " código != 2xx: " + code);
                                    firstBadCode.compareAndSet(-1, code);
                                    discardedHttp.incrementAndGet();
                                    failures++;
                                    if (failures < MAX_STREAM_FAILURES) backoffSleep(failures);
                                    continue;
                                }

                                failures = 0;
                                reusable = true;
                                double secs = (t1 - t0) / 1e9;
                                double sampleMbps = secs > 0 ? (written * 8.0) / secs / 1e6 : 0;

                                if (!warmupDone) {
                                    // Primera request del stream: TCP slow-start, no cuenta.
                                    warmupDone = true;
                                } else if (sampleMbps > MAX_PLAUSIBLE_MBPS) {
                                    // Imposible desde un teléfono por WiFi: artefacto.
                                    discardedImplausible.incrementAndGet();
                                    android.util.Log.w("WifixSpeedtest",
                                        "upload stream " + idx + " muestra descartada: "
                                        + sampleMbps + " Mbps");
                                } else {
                                    bytes.addAndGet(written);
                                    streamBytes += written;
                                    samples.incrementAndGet();
                                    long relT0 = t0 - startNs, relT1 = t1 - startNs;
                                    long prev;
                                    do { prev = firstSampleNs.get(); }
                                    while (relT0 < prev && !firstSampleNs.compareAndSet(prev, relT0));
                                    do { prev = lastSampleNs.get(); }
                                    while (relT1 > prev && !lastSampleNs.compareAndSet(prev, relT1));
                                }

                                // Ajuste del tamaño para apuntar a ~2 s por request.
                                double ms = secs * 1000.0;
                                if (ms > 1) {
                                    long next = (long) (written * (TARGET_REQ_MS / ms));
                                    payload = Math.max(MIN_PAYLOAD, Math.min(MAX_PAYLOAD, next));
                                } else {
                                    payload = Math.min(MAX_PAYLOAD, payload * 4);
                                }
                            } catch (Exception e) {
                                android.util.Log.w("WifixSpeedtest",
                                    "upload stream " + idx + " excepción: " + e.getMessage());
                                lastError[0] = e.getMessage();
                                failures++;
                                if (failures < MAX_STREAM_FAILURES) backoffSleep(failures);
                            } finally {
                                // Sólo se desconecta el socket inservible; el limpio
                                // queda en el pool de keep-alive.
                                if (conn != null && !reusable) conn.disconnect();
                            }
                            android.util.Log.i("WifixSpeedtest",
                                "upload stream " + idx + " code=" + code
                                + " payload=" + payload
                                + " bytesConfirmados=" + streamBytes);
                        }
                        if (failures >= MAX_STREAM_FAILURES) gaveUp.incrementAndGet();
                        liveStreams.decrementAndGet();
                    });
                    workers[i].start();
                }

                runReporter("upload", bytes, abort, start, minMs, maxMs, liveStreams);

                for (Thread w : workers) { try { w.join(3000); } catch (Exception ignored) {} }

                long elapsed = System.currentTimeMillis() - start;
                long total = bytes.get();
                // Ventana real cubierta por las muestras válidas (los streams se
                // solapan, por eso es [primer inicio, última respuesta] y no la
                // suma de duraciones).
                double windowSecs = samples.get() > 0 && lastSampleNs.get() > firstSampleNs.get()
                    ? (lastSampleNs.get() - firstSampleNs.get()) / 1e9 : 0;
                double mbps = windowSecs > 0.2 ? (total * 8.0) / windowSecs / 1e6 : 0;
                boolean implausible = mbps > MAX_PLAUSIBLE_MBPS;
                if (implausible) {
                    // No promediamos basura: se reporta 0 + flag y el JS decide
                    // (fallback etiquetado) en vez de mostrar 7000 Mbps.
                    android.util.Log.w("WifixSpeedtest",
                        "upload agregado imposible (" + mbps + " Mbps) — se reporta 0");
                    mbps = 0;
                }
                android.util.Log.i("WifixSpeedtest",
                    "upload bytesConfirmados=" + total + " elapsedMs=" + elapsed
                    + " windowSecs=" + windowSecs + " muestras=" + samples.get()
                    + " descartadasHttp=" + discardedHttp.get()
                    + " descartadasImposibles=" + discardedImplausible.get()
                    + " mbps=" + mbps);

                JSObject result = new JSObject();
                result.put("uploadMbps", mbps);
                result.put("uploadBytes", total);
                result.put("uploadElapsedMs", elapsed);
                // Campos de diagnóstico (siempre presentes).
                result.put("uploadWindowMs", (long) (windowSecs * 1000));
                result.put("uploadSamples", samples.get());
                result.put("uploadFirstHttpCode", firstBadCode.get());
                result.put("uploadDiscardedHttp", discardedHttp.get());
                result.put("uploadDiscardedImplausible", discardedImplausible.get());
                result.put("uploadStreamsGaveUp", gaveUp.get());
                result.put("uploadImplausible", implausible);
                result.put("uploadLastError", lastError[0]);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("uploadTest falló: " + e.getMessage(), e);
            }
        }).start();
    }

    // -----------------------------------------------------------------------
    // runReporter — bucle de ~300ms que mantiene una ventana móvil de 2s y
    // emite "speedtestProgress" con mbps en vivo. Pone abort=true al llegar a
    // minMs (o maxMs como tope duro). Bloquea el hilo llamante hasta abortar.
    //
    // Corta ANTES si todos los streams se dieron por vencidos (liveStreams==0):
    // sin eso, un endpoint que devuelve 307/429 hacía esperar los 15 s completos
    // martillándolo, y recién ahí se caía al fallback.
    //
    // Devuelve { msDelFinDelRampUp, bytesAcumuladosEnEseInstante } para que el
    // llamante calcule el mbps sobre la ventana estable. Si el test terminó
    // antes del ramp-up devuelve {0,0}.
    // -----------------------------------------------------------------------
    private long[] runReporter(String phase, AtomicLong bytes, AtomicBoolean abort,
                               long start, int minMs, int maxMs,
                               AtomicInteger liveStreams) {
        // Ventana móvil: arrays paralelos de timestamp/bytes acumulados.
        java.util.ArrayDeque<long[]> window = new java.util.ArrayDeque<>();
        long rampAtMs = 0, rampBytes = 0;
        while (true) {
            try { Thread.sleep(300); } catch (InterruptedException ignored) {}
            long now = System.currentTimeMillis();
            long acc = bytes.get();
            window.addLast(new long[]{ now, acc });
            while (window.size() > 1 && now - window.peekFirst()[0] > 2000) {
                window.pollFirst();
            }
            double liveMbps = 0;
            if (window.size() >= 2) {
                long[] first = window.peekFirst();
                double dt = (now - first[0]) / 1000.0;
                long db = acc - first[1];
                if (dt > 0) liveMbps = (db * 8.0) / dt / 1e6;
            }
            long elapsed = now - start;
            // Marca el fin del ramp-up (TCP slow-start): lo anterior no promedia.
            if (rampAtMs == 0 && elapsed >= RAMP_UP_MS) {
                rampAtMs = now;
                rampBytes = acc;
            }
            JSObject p = new JSObject();
            p.put("phase", phase);
            p.put("mbps", liveMbps);
            p.put("elapsedMs", elapsed);
            p.put("progress", Math.min(1.0, elapsed / (double) minMs));
            notifyListeners("speedtestProgress", p);

            if (elapsed >= minMs || elapsed >= maxMs) {
                abort.set(true);
                break;
            }
            // Todos los streams abandonaron: cortar ya y dejar que el JS caiga
            // al fallback en vez de esperar la ventana completa.
            if (liveStreams != null && liveStreams.get() <= 0) {
                android.util.Log.w("WifixSpeedtest",
                    phase + ": todos los streams abandonaron a los " + elapsed + " ms");
                abort.set(true);
                break;
            }
        }
        return new long[]{ rampAtMs, rampBytes };
    }

    // -----------------------------------------------------------------------
    // Helpers HTTP nativos
    // -----------------------------------------------------------------------
    private HttpURLConnection openGet(String url) throws Exception {
        URL u = new URL(url);
        HttpURLConnection conn = (HttpURLConnection) u.openConnection();
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(15000);
        conn.setUseCaches(false);
        conn.setRequestMethod("GET");
        conn.setInstanceFollowRedirects(true);
        conn.setRequestProperty("User-Agent", SPEEDTEST_UA);
        conn.setRequestProperty("Cache-Control", "no-cache");
        return conn;
    }

    /**
     * GET siguiendo redirecciones A MANO (hasta MAX_REDIRECTS saltos).
     *
     * HttpURLConnection NO sigue redirecciones que cambian de esquema
     * (http→https o https→http): las ignora y devuelve el 3xx crudo. Los
     * servidores Ookla suelen responder 307 hacia https en los assets de
     * descarga, y por eso el test moría con "servidor HTTP 307" sin haber
     * bajado un solo byte. Aquí resolvemos el Location nosotros (absoluto o
     * relativo) y devolvemos ya la conexión final.
     *
     * La conexión devuelta puede traer cualquier código (200, 404, 429…): el
     * llamante decide. Sólo se garantiza que no es un 3xx con Location.
     */
    private HttpURLConnection openGetFollowing(String url) throws Exception {
        String current = url;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            HttpURLConnection conn = openGet(current);
            int code = conn.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String loc = conn.getHeaderField("Location");
                drainError(conn);
                conn.disconnect();
                if (loc == null || loc.isEmpty()) {
                    throw new Exception("redirección " + code + " sin Location");
                }
                current = new URL(new URL(current), loc).toString();
                continue;
            }
            return conn;
        }
        throw new Exception("demasiadas redirecciones (>" + MAX_REDIRECTS + ")");
    }

    /** Backoff exponencial por stream: 300ms, 600, 1200, 2400, tope 3000. */
    private void backoffSleep(int consecutiveFailures) {
        long ms = Math.min(3000L, 300L * (1L << Math.min(4, Math.max(0, consecutiveFailures - 1))));
        try { Thread.sleep(ms); } catch (InterruptedException ignored) {}
    }

    /** Lee el header de edge de Cloudflare (cf-meta-colo, si no cf-ray). */
    private String readColo(HttpURLConnection conn) {
        try {
            String colo = conn.getHeaderField("cf-meta-colo");
            if (colo != null && !colo.isEmpty()) return colo;
            String ray = conn.getHeaderField("cf-ray");
            if (ray != null && ray.contains("-")) {
                return ray.substring(ray.indexOf('-') + 1).trim();
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** Drena el errorStream de una conexión con código != 2xx para liberarla. */
    private void drainError(HttpURLConnection conn) {
        try {
            InputStream es = conn.getErrorStream();
            if (es == null) return;
            byte[] sink = new byte[8192];
            while (es.read(sink) != -1) { /* descarta */ }
            es.close();
        } catch (Exception ignored) {}
    }

    /** Drena el body (input o error según el código) para cerrar la conexión. */
    private void drainBody(HttpURLConnection conn, int code) {
        try {
            InputStream in = (code >= 200 && code < 400)
                ? conn.getInputStream() : conn.getErrorStream();
            if (in == null) return;
            byte[] sink = new byte[8192];
            while (in.read(sink) != -1) { /* descarta */ }
            in.close();
        } catch (Exception ignored) {}
    }

    /** GET completo a una url con cache-buster; true si respondió 2xx y se drenó. */
    private boolean drainGet(String url, int n) {
        HttpURLConnection conn = null;
        try {
            String full = url + (url.contains("?") ? "&" : "?")
                    + "n=" + System.currentTimeMillis() + "_" + n;
            // Sigue redirecciones (incluido http↔https) antes de juzgar el código:
            // un 307 ya no cuenta como "servidor vivo" ni como fallo.
            conn = openGetFollowing(full);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return false;
            InputStream in = conn.getInputStream();
            byte[] buf = new byte[8192];
            while (in.read(buf) != -1) { /* drena */ }
            in.close();
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String readAll(Process p) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append('\n');
        }
        return sb.toString();
    }
}
