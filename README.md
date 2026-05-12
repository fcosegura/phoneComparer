# phoneComparer

Comparador dinamico de smartphones construido con `React + Vite` en el frontend y un unico `Cloudflare Worker` para API, cache y entrega de assets estaticos.

## Arquitectura

- `src/worker.js`: entrypoint unico del Worker.
- `dist/`: build estatico servido mediante `env.ASSETS.fetch(request)`.
- `schema.sql`: bootstrap inicial para `D1`.
- `wrangler.jsonc`: bindings de `ASSETS`, `DB` y `AI`.
- `public/sw.js` + `public/manifest.json`: base PWA ligera.

La app permite introducir entre 2 y 5 dispositivos, consulta fuentes web publicas de forma best-effort, usa `Workers AI` para estructurar y comparar la informacion y guarda la ficha de cada dispositivo en `D1` para evitar repetir busquedas.

## Stack

- `React 19`
- `Vite 8`
- `JavaScript ES modules`
- `Node.js >= 22`
- `ESLint 9` con reglas de React y hooks
- `Cloudflare Workers + Assets + D1 + Workers AI`

## Configuracion Cloudflare

Antes de levantar el stack completo, ajusta `wrangler.jsonc`:

1. Reemplaza `d1_databases[0].database_id` por el UUID real de tu base D1.
2. Si quieres cambiar el nombre de la base, actualiza tambien `database_name`.
3. Opcionalmente ajusta:
   - `vars.DEVICE_CACHE_TTL_DAYS`
   - `vars.MAX_WEB_SOURCES`
   - `vars.AI_MODEL`

## Scripts

- `npm run dev`: UI sola con Vite.
- `npm run build`: genera `dist/`.
- `npm run lint`: ejecuta ESLint.
- `npm run check`: lint + build.
- `npm run cf:db:local`: aplica `schema.sql` en la D1 local.
- `npm run cf:dev`: lanza `wrangler dev --local` en `http://localhost:8788`.
- `npm run dev:full`: build inicial + schema local + Worker local.
- `npm run dev:live`: watcher con debounce para rebuild de `dist` + Worker local.
- `npm run deploy`: `vite build && wrangler deploy`.

## Desarrollo local recomendado

```bash
npm install
npm run dev:full
```

Eso hace:

1. `vite build`
2. `wrangler d1 execute <database_name> --local --file=schema.sql`
3. `wrangler dev --local --ip localhost --port 8788`

Si quieres separar UI y backend:

```bash
npm run dev
```

## API

### `GET /api/health`

Chequeo rapido del Worker.

### `POST /api/compare`

Body esperado:

```json
{
  "devices": ["Samsung Galaxy S24", "iPhone 16", "Pixel 9 Pro"],
  "forceRefresh": false
}
```

Respuesta:

- fichas estructuradas por dispositivo,
- resumen y nivel de confianza,
- fuentes utilizadas,
- categorias con ventaja,
- ganador global,
- resumen de `cache hits` y consultas nuevas.

## Notas importantes

- La busqueda web actual usa recuperacion HTTP de fuentes publicas; no depende de una API de search externa.
- Si `Workers AI` falla o no esta disponible, la app sigue respondiendo con un fallback heuristico.
- La cookie/sesion y el login de Google no estan implementados todavia porque esta primera version se centra en el comparador dinamico.
