# Wifix Certificate — WebApp

Webapp mobile-first de Wifix Certificate para tecnicos de campo: instalaciones
de fibra optica y visitas tecnicas.

## Features

- **Main menu**: Instalaciones and Visitas Técnicas
- **Account input**: technician enters the client account number
- **Sub-categories**: Datos Personales, Datos del Servicio, Red Interna, Herramientas
- **Datos Personales**: nombre, dirección, teléfonos, coordenadas, plan, velocidad
- **Datos del Servicio** (Instalaciones): NAPs cercanas, status de cliente, puertos por NAP, eventos del nodo, observaciones de cierre, visitas anteriores, registro de fotos

Currently all data is mocked client-side in `app.js`. The mock builders are isolated functions ready to be swapped for real API calls.

## Run locally

```bash
npx http-server . -p 5173
```

Then open <http://localhost:5173>.

## Stack

- Vanilla HTML / CSS / JS — no build step
- Fonts: **Ubuntu** (300/400/500/700) auto-hospedada en `fonts/` — sin Google Fonts,
  la app se ve igual sin conexión
- Identidad visual **Xtrim** (tema claro): tokens en el `:root` de `styles.css`
  (morado `#783484`, CTA amarillo `#FFCF00` con texto `#44224C`, fondo `#F4F0FA`)
- Phone-aspect frame for desktop preview, full-bleed on mobile

## Iconos

```bash
node scripts/generate-icons.mjs
```

Regenera los iconos PWA (`icons/`), los launcher icons de Android
(`android/.../mipmap-*`) y los splash (`android/.../drawable*`) con la paleta Xtrim.
