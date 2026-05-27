package com.tulpa.wifix.plugins;

import android.Manifest;
import android.content.Context;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;

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
            // 0..4 (5 niveles)
            r.put("signalLevel", WifiManager.calculateSignalLevel(info.getRssi(), 5));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("getWifiInfo falló: " + e.getMessage(), e);
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
