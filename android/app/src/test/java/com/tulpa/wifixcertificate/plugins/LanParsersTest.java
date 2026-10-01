package com.tulpa.wifixcertificate.plugins;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Pruebas JVM de LanParsers (paquetes binarios y parsers portados de Wifix Remote). */
public class LanParsersTest {

    // ---------------------------------------------------------------- helpers

    private static final class Pkt {
        final ByteArrayOutputStream b = new ByteArrayOutputStream();

        Pkt u8(int... v) { for (int x : v) b.write(x & 0xFF); return this; }
        Pkt u16(int v) { return u8(v >> 8, v); }
        Pkt name(String n) {
            for (String l : n.split("\\.")) {
                byte[] x = l.getBytes(StandardCharsets.UTF_8);
                b.write(x.length);
                b.write(x, 0, x.length);
            }
            b.write(0);
            return this;
        }
        Pkt ptr(int off) { return u8(0xC0 | (off >> 8), off); }
        Pkt str(String s) { byte[] x = s.getBytes(StandardCharsets.UTF_8); b.write(x, 0, x.length); return this; }
        int size() { return b.size(); }
        byte[] bytes() { return b.toByteArray(); }
    }

    private static Pkt header(int qd, int an, int ns, int ar) {
        return new Pkt().u16(0).u16(0x8400).u16(qd).u16(an).u16(ns).u16(ar);
    }

    // ---------------------------------------------------------------- stats

    @Test
    public void statsFromRtts_formaDelOrigen() {
        LanParsers.Stat s = LanParsers.statsFromRtts(Arrays.asList(10.0, 20.0, 30.0), 4);
        assertEquals(4, s.sent);
        assertEquals(3, s.received);
        assertEquals(25.0, s.packetLoss, 0);
        assertEquals(20.0, s.avg, 0);
        assertEquals(20.0, s.time, 0);
        assertEquals(10.0, s.min, 0);
        assertEquals(30.0, s.max, 0);
        // desviación poblacional: sqrt(200/3) = 8.164… → 8.2
        assertEquals(8.2, s.stddev, 0);
        assertArrayEquals(new double[] { 10, 20, 30 }, s.samples, 0);
    }

    @Test
    public void statsFromRtts_sinRespuestas() {
        LanParsers.Stat s = LanParsers.statsFromRtts(new ArrayList<>(), 5);
        assertEquals(100.0, s.packetLoss, 0);
        assertNull(s.avg);
        assertNull(s.stddev);
        LanParsers.Stat n = LanParsers.noResponseStat();
        assertEquals(100.0, n.packetLoss, 0);
        assertEquals(0, n.sent);
    }

    @Test
    public void packetLoss_redondeoAUnDecimal() {
        LanParsers.Stat s = LanParsers.statsFromRtts(Arrays.asList(1.0, 1.0), 3);
        assertEquals(33.3, s.packetLoss, 0);
    }

    // ---------------------------------------------------------------- PTR

    @Test
    public void buildPtrQuery_mdnsYUnicast() {
        assertEquals("10.1.168.192.in-addr.arpa", LanParsers.buildReverseName("192.168.1.10"));
        assertNull(LanParsers.buildReverseName("192.168.1"));

        byte[] q = LanParsers.buildPtrQuery("10.1.168.192.in-addr.arpa", true);
        // header mDNS: flags 0x0000, QDCOUNT 1
        assertArrayEquals(new byte[] { 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0 }, Arrays.copyOf(q, 12));
        assertEquals(2, q[12]);
        assertEquals('1', q[13]);
        int n = q.length;
        assertArrayEquals(new byte[] { 0, 0x0C, (byte) 0x80, 0x01 }, Arrays.copyOfRange(q, n - 4, n));

        byte[] u = LanParsers.buildPtrQuery("10.1.168.192.in-addr.arpa", false);
        assertEquals(0x01, u[2]); // RD
        assertArrayEquals(new byte[] { 0, 0x0C, 0x00, 0x01 }, Arrays.copyOfRange(u, u.length - 4, u.length));
    }

    @Test
    public void parsePtrResponse_conPreguntaYPuntero() {
        Pkt p = header(1, 1, 0, 0);
        int qnameOff = p.size();
        p.name("10.1.168.192.in-addr.arpa").u16(12).u16(1);
        p.ptr(qnameOff).u16(12).u16(1).u8(0, 0, 0, 120);
        Pkt rd = new Pkt().name("Living-Room-TV.local");
        p.u16(rd.size()).u8(toInts(rd.bytes()));
        byte[] b = p.bytes();
        assertEquals("Living-Room-TV", LanParsers.parsePtrResponse(b, b.length));
        // unicast: igual, y descarta nombre == ip
        assertEquals("Living-Room-TV", LanParsers.parseUnicastPtrResponse(b, b.length, "192.168.1.10"));
    }

    @Test
    public void parsePtrResponse_sinRespuestas_yNombreIgualIp() {
        byte[] noAns = header(0, 0, 0, 0).bytes();
        assertNull(LanParsers.parsePtrResponse(noAns, noAns.length));

        Pkt p = header(0, 1, 0, 0);
        p.name("10.1.168.192.in-addr.arpa").u16(12).u16(1).u8(0, 0, 0, 1);
        Pkt rd = new Pkt().name("192.168.1.10");
        p.u16(rd.size()).u8(toInts(rd.bytes()));
        byte[] b = p.bytes();
        assertEquals("192.168.1.10", LanParsers.parsePtrResponse(b, b.length));
        assertNull(LanParsers.parseUnicastPtrResponse(b, b.length, "192.168.1.10"));
    }

    // ---------------------------------------------------------------- NetBIOS

    @Test
    public void netbiosRequest_byteAByte() {
        byte[] r = LanParsers.NETBIOS_REQUEST;
        assertEquals(50, r.length);
        assertEquals((byte) 0xA2, r[0]);
        assertEquals(0x48, r[1]);
        assertEquals(0x20, r[12]);
        assertEquals(0x43, r[13]);
        assertEquals(0x4B, r[14]);
        assertEquals(0x21, r[47]);
        assertEquals(0x01, r[49]);
    }

    @Test
    public void parseNetbios_nombreYMac() {
        byte[] resp = new byte[57 + 18 * 2 + 6];
        resp[56] = 2; // nameCount
        byte[] name = "DESKTOP-ABC    ".getBytes(StandardCharsets.ISO_8859_1);
        System.arraycopy(name, 0, resp, 57, 15);
        int macOff = 57 + 18 * 2;
        byte[] mac = { 0x00, 0x1A, 0x2B, 0x3C, 0x4D, 0x5E };
        System.arraycopy(mac, 0, resp, macOff, 6);
        LanParsers.NetbiosResult r = LanParsers.parseNetbios(resp, resp.length);
        assertEquals("DESKTOP-ABC", r.name);
        assertEquals("00:1a:2b:3c:4d:5e", r.mac);
    }

    @Test
    public void parseNetbios_cortaYMacCero() {
        assertNull(LanParsers.parseNetbios(new byte[20], 20).name);
        byte[] resp = new byte[57 + 18 + 6];
        resp[56] = 1;
        System.arraycopy("PC1\u0000\u0000".getBytes(StandardCharsets.ISO_8859_1), 0, resp, 57, 5);
        LanParsers.NetbiosResult r = LanParsers.parseNetbios(resp, resp.length);
        assertEquals("PC1", r.name);
        assertNull(r.mac); // 00:00:00:00:00:00 → null
    }

    // ---------------------------------------------------------------- DNS-SD

    @Test
    public void buildQuery_saltaLabelsVacios() {
        byte[] q = LanParsers.buildQuery("_googlecast._tcp.local.", LanParsers.TYPE_PTR, true);
        byte[] tail = Arrays.copyOfRange(q, q.length - 5, q.length);
        assertArrayEquals(new byte[] { 0, 0, 12, (byte) 0x80, 1 }, tail);
        assertEquals(11, q[12]);
    }

    @Test
    public void parseDnsRecords_yCorrelacion_PTR_SRV_TXT_A() {
        Pkt p = header(0, 1, 0, 3);
        int svcOff = p.size();
        p.name("_googlecast._tcp.local").u16(12).u16(1).u8(0, 0, 0, 120);
        // PTR → instancia
        Pkt rd = new Pkt().str("").u8(toInts(labelBytes("Sala TV"))).ptr(svcOff);
        p.u16(rd.size());
        int instOff = p.size();
        p.u8(toInts(rd.bytes()));
        // SRV de la instancia
        Pkt srv = new Pkt().u16(0).u16(0).u16(8009).name("chromecast-1.local");
        p.ptr(instOff).u16(33).u16(0x8001).u8(0, 0, 0, 120).u16(srv.size());
        int hostOff = p.size() + 6;
        p.u8(toInts(srv.bytes()));
        // TXT con fn
        Pkt txt = new Pkt().u8(toInts(txtEntry("fn=Sala de estar"))).u8(toInts(txtEntry("MD=Chromecast")));
        p.ptr(instOff).u16(16).u16(0x8001).u8(0, 0, 0, 120).u16(txt.size()).u8(toInts(txt.bytes()));
        // A del host
        p.ptr(hostOff).u16(1).u16(0x8001).u8(0, 0, 0, 120).u16(4).u8(192, 168, 1, 50);
        byte[] b = p.bytes();

        List<LanParsers.DnsRecord> recs = LanParsers.parseDnsRecords(b, b.length);
        assertEquals(4, recs.size());
        assertEquals(LanParsers.TYPE_PTR, recs.get(0).type);
        assertEquals("Sala TV._googlecast._tcp.local", recs.get(0).target);
        assertEquals(8009, recs.get(1).port);
        assertEquals("chromecast-1.local", recs.get(1).target);
        assertEquals("Sala de estar", recs.get(2).txt.get("fn"));
        assertEquals("Chromecast", recs.get(2).txt.get("md"));
        assertEquals("192.168.1.50", recs.get(3).ip);

        List<LanParsers.Device> devs = LanParsers.correlateMdns(recs);
        assertEquals(1, devs.size());
        assertEquals("192.168.1.50", devs.get(0).ip);
        assertEquals("Sala de estar", devs.get(0).name);
        assertEquals("Chromecast", devs.get(0).type);
        assertEquals("mdns", devs.get(0).source);
    }

    @Test
    public void parseDnsRecords_truncadoDevuelveAcumulado() {
        byte[] b = header(0, 2, 0, 0).name("a.local").u16(1).u16(1).u8(0, 0, 0, 1).u16(4).u8(10, 0, 0, 1)
            .name("b.local").u16(1).bytes(); // segundo record cortado
        List<LanParsers.DnsRecord> recs = LanParsers.parseDnsRecords(b, b.length);
        assertEquals(1, recs.size());
        assertEquals("10.0.0.1", recs.get(0).ip);
    }

    @Test
    public void instanceLabel_yMapServiceType() {
        assertEquals("Living Room", LanParsers.instanceLabel("Living Room._airplay._tcp.local", "_airplay._tcp.local"));
        assertNull(LanParsers.instanceLabel("amzn.dmgr:ABC:def._amzn-wplay._tcp.local", "_amzn-wplay._tcp.local"));
        assertNull(LanParsers.instanceLabel("a1b2c3d4e5f6a7b8._hap._tcp.local", "_hap._tcp.local"));
        assertEquals("Impresora", LanParsers.mapServiceType("_ipps._tcp.local"));
        assertEquals("AppleTV", LanParsers.mapServiceType("_raop._tcp.local"));
        assertNull(LanParsers.mapServiceType("_http._tcp.local"));
        assertEquals(16, LanParsers.mdnsBrowseQueries().size());
    }

    // ---------------------------------------------------------------- SSDP / UPnP

    @Test
    public void ssdpLocation_yXml() {
        String resp = "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\n"
            + "Location: http://192.168.1.1:1900/igd.xml\r\nST: upnp:rootdevice\r\n\r\n";
        assertEquals("http://192.168.1.1:1900/igd.xml", LanParsers.parseSsdpLocation(resp));
        assertNull(LanParsers.parseSsdpLocation("HTTP/1.1 200 OK\r\n\r\n"));
        assertTrue(LanParsers.MSEARCH.startsWith("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\n"));
        assertTrue(LanParsers.MSEARCH.contains("MX: 2\r\nST: ssdp:all\r\n\r\n"));

        String xml = "<?xml version=\"1.0\"?><root><device>"
            + "<deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>"
            + "<friendlyName><![CDATA[Router &amp; Co]]></friendlyName>"
            + "<manufacturer>Huawei</manufacturer><modelName>HG8145V5</modelName>"
            + "</device></root>";
        LanParsers.UpnpInfo info = LanParsers.parseUpnpXml(xml);
        assertEquals("Router & Co", info.friendlyName);
        assertEquals("Huawei", info.manufacturer);
        assertEquals("HG8145V5", info.modelName);
        assertEquals("Router", LanParsers.mapUpnpType(info.deviceType, info.manufacturer, info.modelName, info.friendlyName));
        assertEquals("AndroidTV", LanParsers.mapUpnpType("urn:schemas-upnp-org:device:MediaRenderer:1", "Samsung", null, "[TV] Sala"));
        assertNull(LanParsers.parseUpnpXml(""));
    }

    @Test
    public void mergeDiscovery_nombreGanaMdns_tipoGanaSsdp() {
        LanParsers.Device ss = new LanParsers.Device();
        ss.ip = "192.168.1.20"; ss.name = "[TV] Samsung"; ss.type = "AndroidTV"; ss.source = "ssdp";
        ss.manufacturer = "Samsung"; ss.model = "QN55";
        LanParsers.Device md = new LanParsers.Device();
        md.ip = "192.168.1.20"; md.name = "Sala TV"; md.type = "AppleTV"; md.source = "mdns";
        Map<String, LanParsers.Device> m = LanParsers.mergeDiscovery(
            Collections.singletonList(md), Collections.singletonList(ss));
        LanParsers.Device d = m.get("192.168.1.20");
        assertEquals("Sala TV", d.name);
        assertEquals("AndroidTV", d.type);
        assertEquals("ssdp+mdns", d.source);
        assertEquals("Samsung", d.manufacturer);
        assertEquals("QN55", d.model);
    }

    // ---------------------------------------------------------------- banner / heurísticas

    @Test
    public void banner_realmYTitle() {
        assertEquals("TP-LINK Wireless", LanParsers.parseRealm("Basic realm=\"TP-LINK Wireless\""));
        assertEquals("HG8145", LanParsers.parseRealm("Digest realm=HG8145, nonce=\"x\""));
        assertEquals("Mi   Router".replaceAll("\\s+", " "),
            LanParsers.parseTitle("<html><TITLE>\n  Mi \n Router </TITLE></html>"));
        assertNull(LanParsers.parseTitle("<html><title></title></html>"));
        assertEquals(Arrays.asList(80, 443), LanParsers.bannerTargets(Arrays.asList(443, 22, 80)));
        assertEquals(Collections.singletonList(80), LanParsers.bannerTargets(Collections.singletonList(22)));
    }

    @Test
    public void heuristicas_yFiltroBasura() {
        assertEquals("Router", LanParsers.guessDeviceType("B866V2M-XTRIM"));
        assertEquals("Móvil", LanParsers.guessDeviceType("Galaxy-S21"));
        assertEquals("Impresora", LanParsers.guessDeviceType("EPSON L3250"));
        assertNull(LanParsers.guessDeviceType("abc"));
        assertEquals("Impresora", LanParsers.guessTypeByPorts(Arrays.asList(80, 9100)));
        assertEquals("PC", LanParsers.guessTypeByPorts(Arrays.asList(445)));
        assertNull(LanParsers.filterJunkName("localhost", "192.168.1.5"));
        assertNull(LanParsers.filterJunkName("192.168.1.5", "192.168.1.5"));
        assertNull(LanParsers.filterJunkName("---", "192.168.1.5"));
        assertEquals("Sala", LanParsers.filterJunkName("Sala", "192.168.1.5"));
    }

    @Test
    public void red_mascaraYPrefijo() {
        assertEquals("255.255.255.0", LanParsers.netmaskFromPrefix(24));
        assertEquals("255.255.252.0", LanParsers.netmaskFromPrefix(22));
        assertEquals(24, LanParsers.prefixFromDhcpNetmask(0x00FFFFFF));
        assertEquals("192.168.100.", LanParsers.slash24Prefix("192.168.100.37"));
        assertNull(LanParsers.slash24Prefix("300.1.1.1"));
    }

    // ---------------------------------------------------------------- util

    private static int[] toInts(byte[] b) {
        int[] r = new int[b.length];
        for (int i = 0; i < b.length; i++) r[i] = b[i] & 0xFF;
        return r;
    }

    private static byte[] labelBytes(String label) {
        byte[] x = label.getBytes(StandardCharsets.UTF_8);
        byte[] r = new byte[x.length + 1];
        r[0] = (byte) x.length;
        System.arraycopy(x, 0, r, 1, x.length);
        return r;
    }

    private static byte[] txtEntry(String s) {
        return labelBytes(s);
    }
}
