// ═══════════════════════════════════════════════════════════════════
//  AeroChat · config
//  ------------------------------------------------------------------
//  Completá estos dos valores con los de TU proyecto de Supabase:
//    Dashboard → Settings → API
//      · Project URL          → AEROCHAT_SUPABASE_URL
//      · anon / public key    → AEROCHAT_SUPABASE_ANON_KEY
//  ═══════════════════════════════════════════════════════════════════

var AEROCHAT_SUPABASE_URL = "https://erdfruvaefqcqqlsjxna.supabase.co";
var AEROCHAT_SUPABASE_ANON_KEY = "sb_publishable_j99DUUYc544Bl_2XYjDrBg_JIBZv-Gh";

// Dominio público de los archivos subidos (Storage).
// Se calcula solo:  {URL}/storage/v1/object/public/{bucket}/{ruta}
function acPublicUrl(bucket, path) {
  return AEROCHAT_SUPABASE_URL + "/storage/v1/object/public/" + bucket + "/" + path;
}

// GIPHY: buscador de GIFs (js/gifs.js). Dejá vacío para usar la beta key
// pública de GIPHY (límite ~100 req/hora). Creá la tuya gratis en
// https://developers.giphy.com → Create an App → API, y ponela acá.
var AEROCHAT_GIPHY_KEY = "";
