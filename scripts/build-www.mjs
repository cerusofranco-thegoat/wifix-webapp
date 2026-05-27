// Copia los assets web (HTML/CSS/JS) a www/ para que Capacitor los empaquete.
// Mantiene los archivos fuente en la raíz para `npx http-server .` y desarrollo
// directo en el navegador.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');

const ASSETS = [
  'index.html',
  'app.js',
  'api.js',
  'native.js',
  'styles.css'
];

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });

let copied = 0;
for (const name of ASSETS) {
  const src = path.join(ROOT, name);
  if (!fs.existsSync(src)) {
    console.warn(`[build-www] skip (no existe): ${name}`);
    continue;
  }
  fs.copyFileSync(src, path.join(WWW, name));
  copied++;
}

console.log(`[build-www] ${copied} archivos copiados a www/`);
