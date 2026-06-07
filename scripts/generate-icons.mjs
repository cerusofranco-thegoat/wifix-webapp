/**
 * Genera los iconos PNG de la PWA para Wifix Tecnico.
 * Colores tomados de styles.css:
 *   background: #05060a (azul-negro muy oscuro)
 *   acento cyan: #00c8ff / #00e0ff
 *
 * Salida: icons/icon-192.png, icons/icon-512.png, icons/apple-touch-icon.png
 *
 * Requiere jimp (devDependency): npm install --save-dev jimp
 */
import { Jimp, JimpMime } from 'jimp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'icons');

fs.mkdirSync(OUT, { recursive: true });

// Colores de marca (RGBA)
const BG_COLOR   = 0x05060aff; // fondo oscuro
const CYAN       = 0x00c8ffff; // acento principal
const CYAN_DIM   = 0x0080aaff; // acento más suave para barras bajas
const WHITE      = 0xffffffff;

/**
 * Dibuja el icono en un Jimp de tamaño `size`.
 * Diseño: fondo oscuro + 4 barras de señal WiFi (marca Wifix) centradas.
 */
async function buildIcon(size) {
  const img = new Jimp({ width: size, height: size, color: BG_COLOR });

  // ---- Borde redondeado simulado con esquinas oscuras ----
  const radius = Math.round(size * 0.18);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inCornerTL = x < radius && y < radius && (x - radius) ** 2 + (y - radius) ** 2 > radius ** 2;
      const inCornerTR = x >= size - radius && y < radius && (x - (size - radius)) ** 2 + (y - radius) ** 2 > radius ** 2;
      const inCornerBL = x < radius && y >= size - radius && (x - radius) ** 2 + (y - (size - radius)) ** 2 > radius ** 2;
      const inCornerBR = x >= size - radius && y >= size - radius && (x - (size - radius)) ** 2 + (y - (size - radius)) ** 2 > radius ** 2;
      if (inCornerTL || inCornerTR || inCornerBL || inCornerBR) {
        img.setPixelColor(0x000000ff, x, y);
      }
    }
  }

  // ---- 4 barras de señal WiFi (ascendentes, de izq a der) ----
  const barCount = 4;
  const totalW   = size * 0.52;
  const gap      = totalW * 0.14;
  const barW     = (totalW - gap * (barCount - 1)) / barCount;
  const maxH     = size * 0.44;
  const baseY    = size * 0.68; // Y de la base de las barras
  const startX   = (size - totalW) / 2;

  for (let i = 0; i < barCount; i++) {
    const fraction = (i + 1) / barCount;          // 0.25, 0.50, 0.75, 1.0
    const barH  = Math.round(maxH * fraction);
    const x0    = Math.round(startX + i * (barW + gap));
    const y0    = Math.round(baseY - barH);
    const x1    = Math.round(x0 + barW);
    const y1    = Math.round(baseY);

    // Color: barras bajas más opacas, las altas con el cyan puro
    const color = fraction >= 0.75 ? CYAN : CYAN_DIM;

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        if (px >= 0 && px < size && py >= 0 && py < size) {
          img.setPixelColor(color, px, py);
        }
      }
    }
  }

  // ---- Punto central debajo de las barras (dot de la W del logo) ----
  const dotR  = Math.round(size * 0.04);
  const dotCX = Math.round(size / 2);
  const dotCY = Math.round(baseY + size * 0.07);
  for (let py = dotCY - dotR; py <= dotCY + dotR; py++) {
    for (let px = dotCX - dotR; px <= dotCX + dotR; px++) {
      if ((px - dotCX) ** 2 + (py - dotCY) ** 2 <= dotR ** 2) {
        if (px >= 0 && px < size && py >= 0 && py < size) {
          img.setPixelColor(CYAN, px, py);
        }
      }
    }
  }

  return img;
}

const sizes = [
  { name: 'icon-192.png',        size: 192 },
  { name: 'icon-512.png',        size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const { name, size } of sizes) {
  const img = await buildIcon(size);
  const dest = path.join(OUT, name);
  await img.write(dest);
  console.log(`[generate-icons] ${name} (${size}x${size}) → ${dest}`);
}

console.log('[generate-icons] Listo.');
