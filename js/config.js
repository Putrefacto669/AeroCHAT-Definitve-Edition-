// ═══════════════════════════════════════════════════════════════════
//  AeroChat · config
//  ------------------------------------------------------------------
//  Completá estos dos valores con los de TU proyecto de Supabase:
//    Dashboard → Settings → API
//      · Project URL          → AEROCHAT_SUPABASE_URL
//      · anon / public key    → AEROCHAT_SUPABASE_ANON_KEY
//  ═══════════════════════════════════════════════════════════════════

var AEROCHAT_SUPABASE_URL = "https://TU-PROYECTO.supabase.co";
var AEROCHAT_SUPABASE_ANON_KEY = "TU-ANON-KEY";

// Dominio público de los archivos subidos (Storage).
// Se calcula solo:  {URL}/storage/v1/object/public/{bucket}/{ruta}
function acPublicUrl(bucket, path) {
  return AEROCHAT_SUPABASE_URL + "/storage/v1/object/public/" + bucket + "/" + path;
}
