# AeroChat (SPA · Supabase)

Migración de la versión ASP.NET Core + SignalR a una aplicación web **estática**
(HTML + CSS + JS) con **Supabase** como backend (Postgres + Auth + Storage +
Realtime + Edge Functions).

La app NO necesita un servidor propio: todo se sirve como archivos estáticos y
toda la lógica vive en **funciones SQL (RPCs)** y en una **Edge Function** para
importar stickers de sticker.ly.

---

## ✈️ Funcionalidades migradas

| Función | Backend |
|---|---|
| Registro / login con usuario + contraseña | Supabase Auth (email sintético `{usuario}@aerochat.local`) |
| Perfiles (avatar, banner, estado, canción de YouTube) | Tabla `profiles` + Storage |
| Amigos, solicitudes, descubrir usuarios | `friend_requests`, `friendships` + RPCs |
| Chats directos (texto, imagen, audio, video, documento) | `messages` + Storage |
| Grupos (miembros, admin, avatar, llamadas de grupo) | `groups` + RPCs |
| Reacciones y "escribiendo…" | `reactions` + Realtime (broadcast) |
| No leídos y ticks de lectura (✓ / ✓✓) | `messages.read_by` + RPCs |
| Estados (historias de 24 h, video, me gusta) | `statuses` / `status_likes` + RLS temporal |
| Stickers (favoritos, usados, importar sticker.ly) | `sticker_packs` / `sticker_favorites` / `sticker_usage` + Edge Function |
| Presencia en línea y llamadas WebRTC (1:1 y grupo) | Realtime (presence + broadcast) + malla P2P |

---

## 🗂 Estructura del proyecto

```
AeroCHhat eb/
├── index.html               → login / registro
├── chat.html                → lista de conversaciones (página principal)
├── conversation.html        → chat directo (DM) con {?u=ID}
├── group.html               → chat de grupo con {?id=ID}
├── status.html              → visor de estados (historias)
├── status-editor.html       → editor de estados (foto/video, stickers, recorte)
├── profile.html             → perfil de usuario con {?u=ID}
├── edit-profile.html        → editar mi perfil / avatar / banner
├── css/
│   └── site.css             → CSS original migrado (sin cambios)
├── js/
│   ├── config.js            → ⚠️ PONER ACA TU URL Y ANON KEY
│   ├── login.js             → login/registro + intro
│   ├── aerochat.js          → helpers globales, sidebar, modales, shell
│   ├── api.js               → envoltorio de TODAS las RPCs
│   ├── realtime.js          → presencia, typing y cambios de tablas
│   ├── messages.js          → render de burbujas, reacciones, búsqueda
│   ├── stickers.js          → panel de stickers compartido
│   ├── calls.js             → llamadas WebRTC (mesh P2P)
│   ├── chat.js              → lógica de conversation.html
│   ├── group.js             → lógica de group.html
│   ├── status.js            → lógica de status.html
│   ├── profile.js           → lógica de profile.html
│   └── edit-profile.js      → lógica de edit-profile.html
├── media/
└── supabase/
    ├── schema.sql           → TODAS las tablas, RLS, RPCs, Realtime, Storage
    └── functions/
        └── import-sticker/
            ├── index.ts     → Edge Function: importar paquete de sticker.ly
            └── deno.json
```

---

## 🚀 Puesta en marcha (paso a paso)

### 1. Crear el proyecto en Supabase

1. Entrá a <https://supabase.com> → **New project**.
2. Copiá el **Project URL** y la **anon key** (Dashboard → Settings → API).

### 2. Ejecutar el schema

1. Dashboard → **SQL Editor** → **New query**.
2. Pegá TODO el contenido de `supabase/schema.sql` y ejecutalo.
   - Crea las 10 tablas, índices, políticas RLS, ~30 funciones RPC, el
     `replica identity` de reacciones, la publicación de Realtime y los
     buckets de Storage.
3. (Opcional) Estados auto-limpiados: activá la extensión **pg_cron** y
   ejecutá la línea comentada al final del archivo.

### 3. Desactivar la confirmación de email

Dashboard → **Authentication → Sign In / Up** → **Confirm email = OFF**.
(Usamos emails sintéticos `@aerochat.local`, nadie va a recibir correos.)

### 4. Completar la configuración

Abrí `js/config.js` y reemplazá los placeholders:

```js
var AEROCHAT_SUPABASE_URL = "https://TU-PROYECTO.supabase.co";
var AEROCHAT_SUPABASE_ANON_KEY = "TU-ANON-KEY";
```

### 5. Desplegar la Edge Function (importador de stickers)

Con el CLI de Supabase (reemplazá `TU-PROYECTO`):

```bash
supabase login
supabase link --project-ref TU-PROYECTO
supabase functions deploy import-sticker --no-verify-jwt
```

> `--no-verify-jwt` está a propósito: la función valida el token por adentro con
> `supabase.auth.getUser()`, así podemos devolver errores JSON legibles al
> cliente en vez de un 401 genérico.

### 6. Servir la app

Cualquier servidor estático sirve. Para desarrollo local:

```bash
python -m http.server 8080
# o
npx serve .
```

Abrí <http://localhost:8080>. **Importante:** el inicio de sesión, Realtime y
las llamadas funcionan solo desde `localhost` o HTTPS (Realtime/WebRTC exigen
"secure context"). Si la abrís desde `file://` o desde una IP, la auth y los
canales pueden fallar.

---

## 🔐 Cómo funciona la seguridad

- **Nada de contraseñas en claro**: las guarda Supabase Auth (hash bcrypt).
- **Toda escritura pasa por funciones `SECURITY DEFINER`** que validan permisos
  en el servidor (`send_friend_request`, `insert_direct_message`,
  `add_group_member`, etc.). El cliente jamás ejecuta INSERT/UPDATE/DELETE
  directos.
- **RLS (Row Level Security)** solo habilita `SELECT` de lo que corresponde:
  - `messages`: solo los DMs donde participás + mensajes de tus grupos.
  - `groups`: solo grupos de los que sos miembro.
  - `statuses`: solo los propios + de amigos, siempre < 24 h.
  - `friendships`/`friend_requests`: solo las tuyas.
- **Storage**: los buckets son de lectura pública; la **escritura solo está
  permitida dentro de la carpeta de tu propio id** (`storage.foldername(name)[1]
  = auth.uid()`). Avatar, banner, mensajes, estados, grupos y stickers usan esa
  regla.
- **Realtime**: el servidor filtra qué filas le entrega a cada suscriptor usando
  las mismas políticas RLS.

### Riesgos del original que la migración corrige

| Problema original | Solución |
|---|---|
| Contraseñas en texto plano en `users.json` | Supabase Auth (bcrypt) |
| Sin CSRF (formularios POST sin token) | Cliente JS + RPCs autenticadas |
| Hub que entregaba mensajes de cualquier chat | RLS filtra por DM/grupo |
| Estados en memoria estática | Tabla `statuses` con expiración de 24 h |
| Persistencia en archivos JSON | PostgreSQL + Storage |
| Sesión por cookie de servidor | JWT de Supabase (`supabase.auth`) |

---

## ⚡ Realtime (reemplaza a SignalR)

| Canal | Tipo | Uso |
|---|---|---|
| `aerochat-presence` | **presence** | Presencia en línea (mapa `AC.online`) |
| `aerochat-typing` | **broadcast** | "escribiendo…" (`typing` / `stop_typing`) |
| `aerochat-tables` | **postgres_changes** | `messages`, `reactions`, `friend_requests`, `friendships`, `groups`, `statuses`, `status_likes`, `profiles` |
| `call-inbox-{userId}` | **broadcast** | Señales de llamada entrante / ocupado / cancelada / etc. |
| `call-{roomId}` | **presence + broadcast** | Roster del mesh + señales WebRTC (offer/answer/candidate) |

- Las llamadas usan **malla P2P** con *perfect negotiation* (el lado "polite"
  es `miId < remoteId`), STUN de Google y Cloudflare.
- Al cerrar/recargar la pestaña (`pagehide`) se destraquea la presencia y se
  cierran los canales.

---

## 📦 Edge Function: import-sticker

Importa un paquete de **sticker.ly** a tu cuenta:

- API: `https://api.sticker.ly/v3.1/stickerPack/{id}`
- User-Agent: `androidapp.stickerly/1.13.3 (G011A; U; Android 22; pt-BR; br;)`
- Reconoce links de los formatos:
  - `https://sticker.ly/s/XXXX` (regex `/\/s\/([A-Za-z0-9]{4,12})/`)
  - `https://sticker.ly/pack/XXXX` (regex `/\/pack\/([A-Za-z0-9]{4,12})/`)
  - `stickerly://pack/XXXX`
- Valida cada imagen por **magic bytes** (PNG/GIF/RIFF…WEBP) y por extensión.
- Sube los archivos a `stickers/{miId}/{packId}/{archivo}` con `upsert:true`.
- Máx. 100 stickers y 3 MB por archivo (igual que el original).
- Al terminar registra el paquete con la RPC `set_sticker_pack`.

Respuesta: `{ name, packId, count, stickers: [urls] }`.
Errores: `{ message: "..." }` con el código HTTP correspondiente.

---

## 🧩 RPCs principales (todas en `supabase/schema.sql`)

**Auth:** `username_available`, `resolve_auth_email`, `create_profile`

**Perfil:** `update_profile`, `set_avatar`, `set_banner`, `get_profile_data`

**Amigos:** `send_friend_request`, `accept_friend_request`,
`decline_friend_request`, `cancel_friend_request`, `remove_friend`, `get_friends`

**Sidebar:** `get_sidebar_data` (me + usuarios + grupos + no leídos en una llamada)

**Mensajes:** `insert_direct_message`, `insert_group_message`, `get_conversation`,
`get_group_messages`, `search_direct`, `search_group`, `edit_message`,
`delete_message`, `toggle_reaction`, `mark_direct_read`, `mark_group_read`,
`get_unread_counts`

**Grupos:** `create_group`, `add_group_member`, `remove_group_member`,
`rename_group`, `set_group_avatar`

**Estados:** `add_status`, `delete_status`, `get_visible_statuses`,
`toggle_status_like`, `cleanup_expired_statuses`

**Stickers:** `toggle_sticker_favorite`, `record_sticker_use`, `set_sticker_pack`,
`get_sticker_packs`, `get_sticker_favorites`, `get_sticker_usage`

---

## 🔬 Probando la app

1. **Registrar 2 usuarios** (ej: `ana`, `bruno`) desde la página de login.
2. `ana` agrega a `bruno` desde **Descubrir** → `bruno` acepta la solicitud.
3. `ana` abre el DM con `bruno`, manda un mensaje; `bruno` lo ve en vivo.
4. Probar reaccionar, responder, editar y eliminar un mensaje.
5. Crear un grupo con ambos y probar mensajes + llamada de grupo.
6. Publicar un **estado** (texto o foto) y verlo desde el otro usuario.
7. Importar un paquete de stickers pegando un link de sticker.ly.
8. Probar llamada de voz/video entre dos pestañas.

---

## 📝 Notas

- `record_sticker_use` se incrementa desde la **Edge Function** al importar y en
  cada envío (ver `api.js`/`stickers.js`).
- El tema claro/oscuro se guarda en `localStorage` (`ac-theme`).
- Los `no leídos` se calculan en el servidor con `get_unread_counts` y se
  actualizan en vivo vía Realtime.
- Si querés depurar, abrí la consola: todos los errores de RPC/Red salen
  prefijados con `AeroChat:`.
