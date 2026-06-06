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
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.util.List;
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

    private String readAll(Process p) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
            String line;
            while ((line = br.readLine()) != null) sb.append(line).append('\n');
        }
        return sb.toString();
    }
}
