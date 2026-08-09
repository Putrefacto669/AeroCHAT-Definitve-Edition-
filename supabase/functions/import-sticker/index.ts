// ═══════════════════════════════════════════════════════════════════
//  Edge Function: import-sticker
//  ------------------------------------------------------------------
//  Replica del StickerController.cs del proyecto original (AeroChat
//  ASP.NET). Descarga un paquete de sticker.ly y lo guarda en el
//  bucket "stickers" de Supabase Storage bajo la carpeta del usuario:
//
//      stickers/{userId}/{packId}/{fileName}
//
//  La ruta empieza por {userId}, por lo que cumple la política RLS
//  "aerochat_own_upload" de Storage (solo se puede escribir en la
//  carpeta propia).
//
//  Endpoint:  POST
//  Body:      { "url": "https://stickers.ly/s/XXXX..." }  (o packId directo)
//  Auth:      Authorization: Bearer <JWT del usuario>  (lo agrega
//             automáticamente supabase.functions.invoke en el cliente)
//  Respuesta: { ok: true, name, author, count, pack_id, stickers: [...] }
//
//  Deploy:
//      supabase functions deploy import-sticker --no-verify-jwt
//  ═══════════════════════════════════════════════════════════════════

import { createClient } from "jsr:@supabase/supabase-js@2";

const PackApi = "https://api.sticker.ly/v3.1/stickerPack/{0}";
const ApiUserAgent = "androidapp.stickerly/1.13.3 (G011A; U; Android 22; pt-BR; br;)";
const MaxStickers = 100;
const MaxStickerBytes = 3 * 1024 * 1024; // 3 MB, igual que el original

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ── Mismo regex de ExtractPackId() del proyecto original ────────────
function extractPackId(url: string): string | null {
  const s = (url || "").trim();
  if (!s) return null;

  const patterns: RegExp[] = [
    /\/s\/([A-Za-z0-9]{4,12})(?:[?#/]|$)/i,
    /\/pack\/([A-Za-z0-9]{4,12})(?:[?#/]|$)/i,
    /^stickerly:\/\/[^/\s]*\/?([A-Za-z0-9]{4,12})(?:[?#]|$)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) return m[1].toUpperCase();
  }
  if (/^[A-Za-z0-9]{4,12}$/.test(s)) return s.toUpperCase();
  return null;
}

// ── Magic bytes, igual que LooksLikeImage() del original ────────────
function looksLikeImage(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // PNG
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true; // GIF8
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true; // RIFF..WEBP
  return false;
}

const extToMime: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

function mimeFor(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  const ext = i === -1 ? "" : fileName.slice(i + 1).toLowerCase();
  return extToMime[ext] || "application/octet-stream";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "Solo se acepta POST" }, 405);

  const auth = req.headers.get("Authorization") || "";
  if (!auth) return json({ ok: false, message: "No autorizado" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, message: "Configuración de Supabase incompleta" }, 500);
  }

  let body: { url?: string };
  try { body = await req.json(); } catch { return json({ ok: false, message: "JSON inválido" }, 400); }

  const packId = extractPackId(body?.url || "");
  if (!packId) return json({ ok: false, message: "Link de sticker.ly no reconocido" }, 400);

  // Cliente con el JWT del usuario: apikey = anon, Authorization = JWT.
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
  });

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return json({ ok: false, message: "Sesión inválida" }, 401);
  const uid = user.id;

  // ── 1. Consultar el paquete en sticker.ly ─────────────────────────
  let res: Response;
  try {
    res = await fetch(PackApi.replace("{0}", encodeURIComponent(packId)), {
      headers: { "User-Agent": ApiUserAgent, "Accept": "application/json" },
    });
  } catch {
    return json({ ok: false, message: "No se pudo contactar sticker.ly" }, 502);
  }

  if (!res.ok) {
    return json({ ok: false, message: `El paquete no existe (${res.status})` }, 502);
  }

  let root: any;
  try { root = await res.json(); } catch {
    return json({ ok: false, message: "Respuesta de sticker.ly inválida" }, 502);
  }

  const result = root?.result;
  if (!result) return json({ ok: false, message: "Respuesta de sticker.ly sin datos" }, 502);

  const name = typeof result.name === "string" && result.name ? result.name : packId;
  const author = typeof result.authorName === "string" ? result.authorName : "";
  const prefix = typeof result.resourceUrlPrefix === "string" ? result.resourceUrlPrefix : null;
  if (!prefix) return json({ ok: false, message: "Paquete sin archivos" }, 502);

  const stickers = result.stickers;
  if (!Array.isArray(stickers) || stickers.length === 0 || stickers.length > MaxStickers) {
    return json({ ok: false, message: "El paquete no tiene stickers válidos" }, 502);
  }

  const fileNameRe = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;

  // ── 2. Descargar y validar cada sticker ───────────────────────────
  const uploaded: string[] = [];
  let errors = 0;

  for (const s of stickers) {
    if (uploaded.length >= MaxStickers) break;
    if (!s || typeof s.fileName !== "string" || !fileNameRe.test(s.fileName)) { errors++; continue; }
    const fileName = s.fileName;

    let bytes: Uint8Array;
    try {
      const r = await fetch(prefix + fileName, { headers: { "User-Agent": ApiUserAgent } });
      if (!r.ok) { errors++; continue; }
      bytes = new Uint8Array(await r.arrayBuffer());
    } catch { errors++; continue; }

    if (bytes.length === 0 || bytes.length > MaxStickerBytes || !looksLikeImage(bytes)) {
      errors++;
      continue;
    }

    // ── 3. Subir al bucket "stickers" dentro de la carpeta del usuario ──
    const path = `${uid}/${packId}/${fileName}`;
    const { error: upErr } = await supabase.storage.from("stickers").upload(path, bytes, {
      contentType: mimeFor(fileName),
      cacheControl: "31536000",
      upsert: true,
    });
    if (upErr) { errors++; continue; }

    uploaded.push(`${supabaseUrl}/storage/v1/object/public/stickers/${path}`);
  }

  if (uploaded.length === 0) {
    return json({ ok: false, message: "No se pudo descargar ningún sticker" }, 502);
  }

  // ── 4. Registrar el paquete en sticker_packs (RPC security definer) ──
  await supabase.rpc("set_sticker_pack", { p_pack_id: packId, p_name: name });

  return json({ ok: true, name, author, pack_id: packId, count: uploaded.length, stickers: uploaded });
});
