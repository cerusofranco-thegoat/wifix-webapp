/**
 * Genera los iconos de Wifix Certificate con la identidad visual de Xtrim.
 *
 * Paleta (tokens de :root en styles.css):
 *   fondo morado   #783484
 *   barras/isotipo #FFCF00 (amarillo CTA) y #E8B800 para las barras bajas
 *
 * Salidas:
 *   PWA      → icons/icon-192.png, icons/icon-512.png, icons/apple-touch-icon.png
 *   Android  → android/.../mipmap-{mdpi..xxxhdpi}: ic_launcher.png,
 *              ic_launcher_round.png, ic_launcher_foreground.png
 *   Splash   → android/.../drawable-*: splash.png (mismas medidas que las actuales)
 *
 * Requiere jimp (devDependency): npm install --save-dev jimp
 * Uso: node scripts/generate-icons.mjs
 *
 * NOTA: este script sólo escribe PNG. No corre `cap sync` ni toca gradle.
 */
import { Jimp } from 'jimp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_PWA = path.join(ROOT, 'icons');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

fs.mkdirSync(OUT_PWA, { recursive: true });

// Colores de marca (RGBA)
const PURPLE      = 0x783484ff; // fondo de marca
const PURPLE_DEEP = 0x44224cff; // morado profundo (sombra del isotipo)
const YELLOW      = 0xffcf00ff; // acento CTA
const YELLOW_DIM  = 0xe8b800ff; // barras bajas
const TRANSPARENT = 0x00000000;

// Se dibuja 4x y se reduce: bordes suaves sin librería de vectores.
const SS = 4;

/**
 * Isotipo Wifix: 4 barras de señal ascendentes + punto inferior.
 * `size` es el lado del lienzo; `scale` cuánto del lienzo ocupa el isotipo
 * (0.52 para los iconos, menor para el foreground adaptativo por la zona segura).
 */
function drawIsotipo(img, size, { scale = 0.52, baseline = 0.68 } = {}) {
  const barCount = 4;
  const totalW = size * scale;
  const gap    = totalW * 0.14;
  const barW   = (totalW - gap * (barCount - 1)) / barCount;
  const maxH   = size * (scale * 0.85);
  const baseY  = size * baseline;
  const startX = (size - totalW) / 2;
  const radius = Math.max(1, Math.round(barW * 0.22));

  for (let i = 0; i < barCount; i++) {
    const fraction = (i + 1) / barCount;
    const barH = Math.round(maxH * fraction);
    const x0 = Math.round(startX + i * (barW + gap));
    const y0 = Math.round(baseY - barH);
    const x1 = Math.round(x0 + barW);
    const y1 = Math.round(baseY);
    const color = fraction >= 0.75 ? YELLOW : YELLOW_DIM;

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        // esquinas superiores redondeadas de cada barra
        const inTopLeft  = px < x0 + radius && py < y0 + radius &&
          (px - (x0 + radius)) ** 2 + (py - (y0 + radius)) ** 2 > radius ** 2;
        const inTopRight = px >= x1 - radius && py < y0 + radius &&
          (px - (x1 - radius)) ** 2 + (py - (y0 + radius)) ** 2 > radius ** 2;
        if (inTopLeft || inTopRight) continue;
        if (px >= 0 && px < size && py >= 0 && py < size) {
          img.setPixelColor(color, px, py);
        }
      }
    }
  }

  // Punto de la "i" bajo las barras
  const dotR  = Math.max(1, Math.round(size * scale * 0.075));
  const dotCX = Math.round(size / 2);
  const dotCY = Math.round(baseY + size * scale * 0.135);
  for (let py = dotCY - dotR; py <= dotCY + dotR; py++) {
    for (let px = dotCX - dotR; px <= dotCX + dotR; px++) {
      if ((px - dotCX) ** 2 + (py - dotCY) ** 2 <= dotR ** 2 &&
          px >= 0 && px < size && py >= 0 && py < size) {
        img.setPixelColor(YELLOW, px, py);
      }
    }
  }
}

/** Recorta el lienzo a esquinas redondeadas (o a un círculo con ratio 0.5). */
function roundCorners(img, size, ratio) {
  const r = Math.round(size * ratio);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const outTL = x < r && y < r && (x - r) ** 2 + (y - r) ** 2 > r ** 2;
      const outTR = x >= size - r && y < r && (x - (size - r)) ** 2 + (y - r) ** 2 > r ** 2;
      const outBL = x < r && y >= size - r && (x - r) ** 2 + (y - (size - r)) ** 2 > r ** 2;
      const outBR = x >= size - r && y >= size - r &&
        (x - (size - r)) ** 2 + (y - (size - r)) ** 2 > r ** 2;
      if (outTL || outTR || outBL || outBR) img.setPixelColor(TRANSPARENT, x, y);
    }
  }
}

/**
 * Icono cuadrado con fondo morado, isotipo amarillo y esquinas redondeadas.
 * `cornerRatio`: 0.18 legacy, 0.5 círculo (ic_launcher_round), 0 sin recorte.
 */
async function buildIcon(size, { cornerRatio = 0.18, scale = 0.52 } = {}) {
  const big = size * SS;
  const img = new Jimp({ width: big, height: big, color: PURPLE });
  drawIsotipo(img, big, { scale });
  if (cornerRatio > 0) roundCorners(img, big, cornerRatio);
  return img.resize({ w: size, h: size });
}

/** Capa foreground del icono adaptativo: transparente + isotipo en zona segura. */
async function buildForeground(size) {
  const big = size * SS;
  const img = new Jimp({ width: big, height: big, color: TRANSPARENT });
  // El adaptive icon recorta hasta 1/3 del lienzo: el isotipo se queda chico.
  drawIsotipo(img, big, { scale: 0.34, baseline: 0.61 });
  return img.resize({ w: size, h: size });
}

/** Splash: fondo morado con el isotipo centrado. */
async function buildSplash(w, h) {
  const img = new Jimp({ width: w, height: h, color: PURPLE });
  const side = Math.min(w, h);
  const iso = new Jimp({ width: side, height: side, color: TRANSPARENT });
  drawIsotipo(iso, side, { scale: 0.30, baseline: 0.60 });
  img.composite(iso, Math.round((w - side) / 2), Math.round((h - side) / 2));
  return img;
}

// --- 1) Iconos PWA ---------------------------------------------------------
const pwa = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];
for (const { name, size } of pwa) {
  const img = await buildIcon(size, { cornerRatio: 0.18 });
  const dest = path.join(OUT_PWA, name);
  await img.write(dest);
  console.log(`[icons] PWA  ${name} (${size}x${size})`);
}

// --- 2) Launcher icons de Android -----------------------------------------
const MIPMAPS = [
  { dir: 'mipmap-mdpi',    legacy: 48,  foreground: 108 },
  { dir: 'mipmap-hdpi',    legacy: 72,  foreground: 162 },
  { dir: 'mipmap-xhdpi',   legacy: 96,  foreground: 216 },
  { dir: 'mipmap-xxhdpi',  legacy: 144, foreground: 324 },
  { dir: 'mipmap-xxxhdpi', legacy: 192, foreground: 432 },
];
for (const { dir, legacy, foreground } of MIPMAPS) {
  const base = path.join(RES, dir);
  if (!fs.existsSync(base)) {
    console.warn(`[icons] skip (no existe): ${dir}`);
    continue;
  }
  const square = await buildIcon(legacy, { cornerRatio: 0.18 });
  await square.write(path.join(base, 'ic_launcher.png'));

  const round = await buildIcon(legacy, { cornerRatio: 0.5 });
  await round.write(path.join(base, 'ic_launcher_round.png'));

  // Sólo se regenera el foreground si ya existía (respeta el layout actual).
  const fgPath = path.join(base, 'ic_launcher_foreground.png');
  if (fs.existsSync(fgPath)) {
    const fg = await buildForeground(foreground);
    await fg.write(fgPath);
  }
  console.log(`[icons] AND  ${dir} (${legacy}px legacy / ${foreground}px foreground)`);
}

// --- 3) Splash screens ----------------------------------------------------
const splashDirs = fs.existsSync(RES)
  ? fs.readdirSync(RES).filter(d => d.startsWith('drawable'))
  : [];
for (const dir of splashDirs) {
  const file = path.join(RES, dir, 'splash.png');
  if (!fs.existsSync(file)) continue;
  const current = await Jimp.read(file);
  const { width, height } = current.bitmap;
  const img = await buildSplash(width, height);
  await img.write(file);
  console.log(`[icons] SPL  ${dir}/splash.png (${width}x${height})`);
}

console.log('[icons] Listo — paleta Xtrim aplicada.');
