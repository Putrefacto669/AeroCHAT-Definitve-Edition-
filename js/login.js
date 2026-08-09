// ═══════════════════════════════════════════════════════════════════
//  AeroChat · login.js
//  ------------------------------------------------------------------
//  Login/registro con Supabase Auth:
//    · Login:    resolve_auth_email(usuario) → signInWithPassword(email)
//    · Registro: username_available → signUp(email sintético) →
//                create_profile(...) (RPC, crea la fila en profiles)
//    · Muestra la intro de video (igual que el original) y el tema.
//  ═══════════════════════════════════════════════════════════════════

// Tema persistido (antes de pintar)
(function () {
  var t = localStorage.getItem('ac-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();

var acSupabase = window.supabase.createClient(AEROCHAT_SUPABASE_URL, AEROCHAT_SUPABASE_ANON_KEY);

function showError(msg) {
  var el = document.getElementById('authError');
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
}
function setBusy(btn, busy) {
  if (!btn) return;
  btn.disabled = busy;
  btn.textContent = busy ? '…' : (btn.getAttribute('data-label') || 'Entrar');
}
function emailFor(username) {
  return String(username).trim().toLowerCase() + '@aerochat.local';
}

// ── Login ───────────────────────────────────────────────────────────
function submitLogin() {
  var username = (document.getElementById('loginUsername').value || '').trim();
  var password = document.getElementById('loginPassword').value;
  if (!username || !password) { showError('Ingresá tu usuario y contraseña.'); return; }
  setBusy(document.getElementById('loginBtn'), true);
  showError('');

  acSupabase.rpc('resolve_auth_email', { p_username: username }).then(function (r) {
    if (r.error) throw r.error;
    var email = r.data;
    if (!email) throw { message: 'Ese usuario no existe.' };
    return acSupabase.auth.signInWithPassword({ email: email, password: password });
  }).then(function (res) {
    if (res.error) {
      var msg = res.error.message || 'Usuario o contraseña incorrectos.';
      if (/invalid login credentials/i.test(msg)) msg = 'Usuario o contraseña incorrectos.';
      throw { message: msg };
    }
    location.href = 'chat.html';
  }).catch(function (e) {
    showError((e && e.message) || 'Usuario o contraseña incorrectos.');
    setBusy(document.getElementById('loginBtn'), false);
  });
}

// ── Registro ────────────────────────────────────────────────────────
function submitRegister() {
  var username = (document.getElementById('regUsername').value || '').trim();
  var displayName = (document.getElementById('regDisplayName').value || '').trim();
  var password = document.getElementById('regPassword').value;
  var confirm = document.getElementById('regConfirm').value;

  if (!username || !displayName || !password || !confirm) {
    showError('Todos los campos son obligatorios.');
    return;
  }
  if (username.length < 3) {
    showError('El usuario debe tener al menos 3 caracteres.');
    return;
  }
  if (!/^[a-z0-9_.-]+$/i.test(username)) {
    showError('El usuario solo puede tener letras, números, guiones y puntos.');
    return;
  }
  if (password.length < 4) {
    showError('La contraseña debe tener al menos 4 caracteres.');
    return;
  }
  if (password !== confirm) {
    showError('Las contraseñas no coinciden.');
    return;
  }

  setBusy(document.getElementById('registerBtn'), true);
  showError('');

  var email = emailFor(username);
  acSupabase.rpc('username_available', { p_username: username }).then(function (r) {
    if (r.error) throw r.error;
    if (!r.data) throw { message: 'Ese nombre de usuario ya está en uso.' };
    return acSupabase.auth.signUp({ email: email, password: password });
  }).then(function (res) {
    if (res.error) {
      var msg = res.error.message || 'No se pudo crear la cuenta.';
      if (/already registered/i.test(msg)) msg = 'Ese nombre de usuario ya está en uso.';
      throw { message: msg };
    }
    if (!res.data || !res.data.session) {
      throw { message: 'Revisá la confirmación de email en el proyecto Supabase (debe estar desactivada).' };
    }
    return acSupabase.rpc('create_profile', {
      p_username: username,
      p_display_name: displayName,
      p_email: email
    }).then(function (r2) {
      if (r2.error) throw r2.error;
      if (!r2.data) throw { message: 'Error al crear el usuario. Intentalo de nuevo.' };
      location.href = 'chat.html';
    });
  }).catch(function (e) {
    showError((e && e.message) || 'Error al crear el usuario. Intentalo de nuevo.');
    setBusy(document.getElementById('registerBtn'), false);
  });
}

// ── Alternar login / registro ───────────────────────────────────────
function toggleForms(showRegister) {
  document.getElementById('loginForm').hidden = showRegister;
  document.getElementById('registerForm').hidden = !showRegister;
  document.getElementById('toLoginWrap').hidden = !showRegister;
  document.querySelector('.login-note').hidden = showRegister;
  showError('');
}

document.addEventListener('DOMContentLoaded', function () {
  // Ya logueado → directo al chat
  acSupabase.auth.getSession().then(function (r) {
    if (r.data && r.data.session) { location.replace('chat.html'); return; }
    initIntro();
  });

  var loginBtn = document.getElementById('loginBtn');
  loginBtn.setAttribute('data-label', loginBtn.textContent);
  document.getElementById('registerBtn').setAttribute('data-label', document.getElementById('registerBtn').textContent);

  document.getElementById('loginForm').addEventListener('submit', function (e) { e.preventDefault(); submitLogin(); });
  document.getElementById('registerForm').addEventListener('submit', function (e) { e.preventDefault(); submitRegister(); });
  document.getElementById('toRegister').addEventListener('click', function (e) { e.preventDefault(); toggleForms(true); });
  document.getElementById('toLogin').addEventListener('click', function (e) { e.preventDefault(); toggleForms(false); });
});

// ── Intro (video) ───────────────────────────────────────────────────
function initIntro() {
  var ov = document.getElementById('introOverlay');
  if (!ov) return;
  var v = document.getElementById('introVideo');
  var bg = document.getElementById('introBgVideo');
  var isPortrait = (window.matchMedia && window.matchMedia('(orientation: portrait)').matches) || (window.innerHeight > window.innerWidth);
  var src = isPortrait ? 'media/intro-vertical.mp4' : 'media/intro.mp4';
  v.src = src;
  if (bg) bg.src = src;
  var done = false;
  var timer = null;

  function dismiss() {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    ov.classList.add('out');
    setTimeout(function () { ov.remove(); }, 650);
  }
  v.addEventListener('error', dismiss);
  v.addEventListener('ended', dismiss);
  v.addEventListener('loadedmetadata', function () {
    var d = (v.duration || 5) * 1000;
    timer = setTimeout(dismiss, d + 400);
  });
  v.muted = true;
  if (bg) bg.muted = true;
  function start(vid) {
    var p = vid.play();
    if (p && p.catch) p.catch(function () {});
  }
  start(v);
  if (bg) start(bg);
  v.addEventListener('loadeddata', function () { start(v); });
  v.addEventListener('canplay', function () { start(v); });
  document.getElementById('introSkip').addEventListener('click', dismiss);
  ov.addEventListener('click', function (e) { if (e.target === ov) dismiss(); });

  var sound = document.getElementById('introSound');
  var offIco = document.getElementById('introSoundOff');
  var onIco = document.getElementById('introSoundOn');
  function setSound(on) {
    v.muted = !on;
    if (offIco) offIco.hidden = on;
    if (onIco) onIco.hidden = !on;
  }
  if (sound) sound.addEventListener('click', function () {
    setSound(v.muted);
    if (!v.muted) start(v);
  });
  var gestureDone = false;
  function enableSound(e) {
    if (gestureDone) return;
    var t = e && e.target;
    if (t && t.closest && t.closest('.intro-sound')) return;
    gestureDone = true;
    setSound(true);
    start(v);
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (evt) {
    document.addEventListener(evt, enableSound, { once: true, passive: true });
  });
  if (!v.readyState) setTimeout(dismiss, 9000);
}
