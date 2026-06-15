package com.tulpa.wifix.plugins;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.util.List;
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
        if (freq >= 5180 && freq <= 5825) return (freq - 5000) / 5;
        if (freq >= 5955 && freq <= 7115) return (freq - 5955) / 5 + 1;
        return -1;
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
    // SPEEDTEST — HTTP nativo (sin CORS, ancho de banda real).
    // El discovery (lista de servers Ookla) lo sigue haciendo JS vía
    // CapacitorHttp; aquí van ping/latencia/download/upload contra el server
    // elegido. Todo usa HttpURLConnection (sin dependencias extra).
    // =======================================================================

    private static final String SPEEDTEST_UA =
        "Mozilla/5.0 (Android) WifixSpeedtest/1.0";

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

                Thread[] workers = new Thread[parallel];
                for (int i = 0; i < parallel; i++) {
                    final int idx = i;
                    workers[i] = new Thread(() -> {
                        byte[] buf = new byte[64 * 1024];
                        long streamBytes = 0;
                        while (!abort.get()) {
                            HttpURLConnection conn = null;
                            // reusable=true sólo cuando leímos el body COMPLETO hasta
                            // EOF (-1): ese socket vuelve al pool de keep-alive y el
                            // siguiente GET lo reutiliza sin re-handshake TCP+TLS.
                            // Si salimos por abort a mitad de body, por código != 200
                            // o por excepción, el socket NO es reutilizable → disconnect.
                            boolean reusable = false;
                            try {
                                conn = openGet(url + (url.contains("?") ? "&" : "?")
                                        + "n=" + Math.random());
                                int code = conn.getResponseCode();
                                if (code != 200) {
                                    android.util.Log.w("WifixSpeedtest",
                                        "download stream " + idx + " código != 200: " + code);
                                    firstBadCode.compareAndSet(-1, code);
                                    streamRetries.incrementAndGet();
                                    try { drainError(conn); } catch (Exception ignored) {}
                                    conn.disconnect();
                                    conn = null;
                                    // Pequeña pausa antes de reintentar el stream.
                                    try { Thread.sleep(150); } catch (InterruptedException ignored) {}
                                    continue;
                                }
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
                            } finally {
                                // Sólo desconectar si el socket NO quedó reutilizable
                                // (abort a medias, excepción). En el camino EOF se omite
                                // a propósito para preservar keep-alive y eliminar los
                                // huecos de reconexión que hacían caer el display en vivo.
                                if (conn != null && !reusable) conn.disconnect();
                            }
                        }
                        android.util.Log.i("WifixSpeedtest",
                            "download stream " + idx + " bytes=" + streamBytes);
                    });
                    workers[i].start();
                }

                runReporter("download", bytes, abort, start, minMs, maxMs);

                for (Thread w : workers) { try { w.join(2000); } catch (Exception ignored) {} }

                long elapsed = System.currentTimeMillis() - start;
                long total = bytes.get();
                double mbps = elapsed > 0 ? (total * 8.0) / (elapsed / 1000.0) / 1e6 : 0;
                android.util.Log.i("WifixSpeedtest",
                    "download total bytes=" + total + " elapsedMs=" + elapsed + " mbps=" + mbps
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
                call.resolve(result);
            } catch (Exception e) {
                call.reject("downloadTest falló: " + e.getMessage(), e);
            }
        }).start();
    }

    // -----------------------------------------------------------------------
    // uploadTest — N hilos hacen POST contra Cloudflare __up. CADA conexión
    // escribe de forma CONTINUA (no un payload finito que se "completa" al
    // instante) en bloques de 64 KB hasta que aborta, contando SÓLO los bytes
    // tras retornar out.write(): así la contrapresión del socket TCP marca el
    // ritmo real de subida. Tras abortar, cierra el stream y OBLIGA la
    // transmisión llamando getResponseCode()/drenando la respuesta.
    //
    // FIX del bug de ~4000 Mbps: la versión anterior enviaba un payload finito
    // de 5 MB y reconectaba; los primeros writes llenan el buffer de envío del
    // kernel al instante y se contaban como "enviados" aunque no salieran por
    // la red antes del out.close()/disconnect(). Al escribir de forma continua
    // y cortar por tiempo (no por tamaño), el conteo refleja exactamente lo que
    // el socket aceptó transmitir durante la ventana de medición.
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

                final AtomicLong bytes = new AtomicLong(0);
                final AtomicBoolean abort = new AtomicBoolean(false);
                final long start = System.currentTimeMillis();

                Thread[] workers = new Thread[parallel];
                for (int i = 0; i < parallel; i++) {
                    final int idx = i;
                    workers[i] = new Thread(() -> {
                        long streamBytes = 0;
                        while (!abort.get()) {
                            HttpURLConnection conn = null;
                            int code = -1;
                            try {
                                URL u = new URL(url + (url.contains("?") ? "&" : "?")
                                        + "n=" + Math.random());
                                conn = (HttpURLConnection) u.openConnection();
                                conn.setConnectTimeout(8000);
                                conn.setReadTimeout(30000);
                                conn.setUseCaches(false);
                                conn.setDoOutput(true);
                                conn.setRequestMethod("POST");
                                conn.setRequestProperty("Content-Type", "application/octet-stream");
                                conn.setRequestProperty("User-Agent", SPEEDTEST_UA);
                                // Chunked: fuerza streaming real al socket, sin
                                // bufferizar todo el cuerpo en RAM ni requerir
                                // Content-Length por adelantado.
                                conn.setChunkedStreamingMode(0);

                                OutputStream out = conn.getOutputStream();
                                // Escritura continua: cada write bloquea cuando
                                // el buffer del socket se llena → el conteo sigue
                                // el ancho de banda real de subida.
                                while (!abort.get()) {
                                    out.write(block, 0, BLOCK);
                                    // Sólo cuenta DESPUÉS de que write() retornó
                                    // (el bloque ya fue aceptado por el socket).
                                    if (abort.get()) break;
                                    bytes.addAndGet(BLOCK);
                                    streamBytes += BLOCK;
                                }
                                try { out.flush(); } catch (Exception ignored) {}
                                try { out.close(); } catch (Exception ignored) {}

                                // OBLIGATORIO: forzar que la petición se
                                // transmita y cierre. Sin getResponseCode()
                                // HttpURLConnection puede no enviar a la red.
                                try {
                                    code = conn.getResponseCode();
                                    drainBody(conn, code);
                                } catch (Exception ignored) {}
                            } catch (Exception e) {
                                android.util.Log.w("WifixSpeedtest",
                                    "upload stream " + idx + " excepción: " + e.getMessage());
                            } finally {
                                if (conn != null) conn.disconnect();
                            }
                            android.util.Log.i("WifixSpeedtest",
                                "upload stream " + idx + " code=" + code
                                + " bytesAcumulados=" + streamBytes);
                        }
                    });
                    workers[i].start();
                }

                runReporter("upload", bytes, abort, start, minMs, maxMs);

                for (Thread w : workers) { try { w.join(2000); } catch (Exception ignored) {} }

                long elapsed = System.currentTimeMillis() - start;
                long total = bytes.get();
                double mbps = elapsed > 0 ? (total * 8.0) / (elapsed / 1000.0) / 1e6 : 0;
                android.util.Log.i("WifixSpeedtest",
                    "upload total bytes=" + total + " elapsedMs=" + elapsed + " mbps=" + mbps);

                JSObject result = new JSObject();
                result.put("uploadMbps", mbps);
                result.put("uploadBytes", total);
                result.put("uploadElapsedMs", elapsed);
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
    // -----------------------------------------------------------------------
    private void runReporter(String phase, AtomicLong bytes, AtomicBoolean abort,
                             long start, int minMs, int maxMs) {
        // Ventana móvil: arrays paralelos de timestamp/bytes acumulados.
        java.util.ArrayDeque<long[]> window = new java.util.ArrayDeque<>();
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
        }
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
        conn.setRequestProperty("User-Agent", SPEEDTEST_UA);
        conn.setRequestProperty("Cache-Control", "no-cache");
        return conn;
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
            conn = openGet(full);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 400) return false;
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
