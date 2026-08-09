// ═══════════════════════════════════════════════════════════════════
//  AeroChat · config
//  ------------------------------------------------------------------
//  Completá estos dos valores con los de TU proyecto de Supabase:
//    Dashboard → Settings → API
//      · Project URL          → AEROCHAT_SUPABASE_URL
//      · anon / public key    → AEROCHAT_SUPABASE_ANON_KEY
//  ═══════════════════════════════════════════════════════════════════

var AEROCHAT_SUPABASE_URL = "https://erdgruvaefqcqqlsjxna.supabase.co";
var AEROCHAT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVyZGZydXZhZWZxY3FxbHNqeG5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyOTQyNjYsImV4cCI6MjEwMTg3MDI2Nn0.tdbciiHc45IqW9fjOJXd9PN22-aICB8woZ43ZpLWKWY";

// Dominio público de los archivos subidos (Storage).
// Se calcula solo:  {URL}/storage/v1/object/public/{bucket}/{ruta}
function acPublicUrl(bucket, path) {
  return AEROCHAT_SUPABASE_URL + "/storage/v1/object/public/" + bucket + "/" + path;
}
