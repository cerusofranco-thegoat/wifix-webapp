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
  'asistencia.js',
  'styles.css',
  'manifest.webmanifest',
];

// Directorios completos que se copian recursivamente a www/
const DIRS = [
  'icons',
];

// Intenta limpiar www/ completo; si está bloqueado (ej. http-server en Windows),
// continúa de todas formas — los archivos se sobreescriben individualmente.
try {
  fs.rmSync(WWW, { recursive: true, force: true });
} catch (e) {
  // En Windows un hijo bloqueado (ej. el .apk servido por http-server) hace
  // fallar el rmdir del directorio con ENOTEMPTY/EPERM/EACCES además de EBUSY.
  // En todos esos casos seguimos: los assets se sobreescriben uno por uno.
  if (!['EBUSY', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
  console.warn('[build-www] www/ bloqueado (servidor activo) — sobreescribiendo archivos individuales.');
}
fs.mkdirSync(WWW, { recursive: true });

let copied = 0;

// Copia archivos individuales
for (const name of ASSETS) {
  const src = path.join(ROOT, name);
  if (!fs.existsSync(src)) {
    console.warn(`[build-www] skip (no existe): ${name}`);
    continue;
  }
  fs.copyFileSync(src, path.join(WWW, name));
  copied++;
}

// Copia directorios completos
for (const dir of DIRS) {
  const srcDir = path.join(ROOT, dir);
  if (!fs.existsSync(srcDir)) {
    console.warn(`[build-www] skip dir (no existe): ${dir}/`);
    continue;
  }
  const destDir = path.join(WWW, dir);
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    const srcFile  = path.join(srcDir, file);
    const destFile = path.join(destDir, file);
    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, destFile);
      copied++;
    }
  }
}

console.log(`[build-www] ${copied} archivos copiados a www/`);
