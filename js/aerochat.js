// ═══════════════════════════════════════════════════════════════════
//  AeroChat · aerochat.js (helpers globales)
//  ------------------------------------------------------------------
//  Equivale a site.js del proyecto original, adaptado a Supabase:
//    · Cliente de Supabase (auth + storage + realtime)
//    · Estado global AC
//    · Tema claro/oscuro, toast, presencia
//    · Modales, sidebar (amigos/solicitudes/grupos/descubrir)
//    · Tira de estados, nuevo grupo, nuevo estado
//    · Acciones de amistad, logout, subida de archivos a Storage
//  ═══════════════════════════════════════════════════════════════════

// ── Cliente + estado global ─────────────────────────────────────────
var acSupabase = window.supabase.createClient(AEROCHAT_SUPABASE_URL, AEROCHAT_SUPABASE_ANON_KEY);

var AC = {
  supabase: acSupabase,
  authUser: null,        // objeto de supabase.auth (tiene .id)
  me: null,              // mi fila de profiles
  users: [],             // todos los usuarios (del sidebar)
  usersById: {},         // id -> usuario (búsqueda rápida)
  groups: [],            // mis grupos
  unread: {},            // key -> nº no leídos (key = id amigo o grupo)
  online: {},            // id usuario -> 1 (presencia)
  view: null,            // página abierta: { kind, id, me, partner|group, ... }
  channels: [],          // canales Realtime activos (para limpiar al salir)
  sidebarTimer: null,
  statusStrip: null,
  typing: {}             // timers de "escribiendo…"
};

window.acOnlineUsers = {};   // compat con los scripts de página (como el original)
window.acToastTimer = null;

// ── Tema ────────────────────────────────────────────────────────────
function syncThemePills() {
  var t = localStorage.getItem('ac-theme') || 'dark';
  document.querySelectorAll('.theme-pill-dark').forEach(function (el) {
    el.classList.toggle('active', t !== 'light');
  });
  document.querySelectorAll('.theme-pill-light').forEach(function (el) {
    el.classList.toggle('active', t === 'light');
  });
}
function toggleTheme() {
  var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('ac-theme', t);
  syncThemePills();
}
(function () {
  var t = localStorage.getItem('ac-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
  syncThemePills();
})();

// ── Toast ───────────────────────────────────────────────────────────
function showToast(msg, type) {
  var t = document.getElementById('acToast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' toast-' + type : '');
  clearTimeout(window.acToastTimer);
  window.acToastTimer = setTimeout(function () { t.className = 'toast'; }, 3200);
}

// ── Presencia (mapa en memoria; lo llena realtime.js) ───────────────
function emitPresence() {
  document.dispatchEvent(new CustomEvent('ac:presence'));
}
function applyPresence() {
  window.acOnlineUsers = AC.online;
  var ids = Object.keys(AC.online);
  document.querySelectorAll('[data-userid]').forEach(function (el) {
    el.classList.toggle('online', ids.indexOf(el.getAttribute('data-userid')) >= 0);
  });
  emitPresence();
}
function markOnline(id) { AC.online[id] = 1; applyPresence(); }
function markOffline(id) { delete AC.online[id]; applyPresence(); }

// ── Modales globales ────────────────────────────────────────────────
function openModal(id) { var el = document.getElementById(id); if (el) el.classList.add('open'); }
function closeModal(id) { var el = document.getElementById(id); if (el) el.classList.remove('open'); }
function openSidebar() {
  var sb = document.getElementById('sidebar'); if (sb) sb.classList.add('open');
  var ov = document.getElementById('sidebarOverlay'); if (ov) ov.classList.add('open');
}
function closeSidebar() {
  var sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('open');
  var ov = document.getElementById('sidebarOverlay'); if (ov) ov.classList.remove('open');
}
document.addEventListener('click', function (e) {
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// ── Helpers de texto ────────────────────────────────────────────────
function escapeHtml(s) {
  var d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
function jsEncode(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}
function acRandomId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ── Iconos SVG ──────────────────────────────────────────────────────
// Todos los iconos de la app se generan con acIcon(name, size, cls, opts)
// y se pintan inline (stroke actual, round caps), así el color se hereda
// del texto/CSS (currentColor). Compatible con los estilos .icon-btn y .btn.
var acIconMap = {
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  plane: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
  'phone-down': '<polyline points="17 1 22 6 17 11"/><line x1="22" y1="6" x2="8" y2="6"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
  video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  'camera-off': '<line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l3-3h6l3 3h3a2 2 0 0 1 2 2v11a2 2 0 0 1-1.71 1.98"/>',
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  'mic-off': '<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  film: '<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  edit: '<path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  reply: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  'message-circle': '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  'check-all': '<polyline points="1 12 5 16 10 11"/><polyline points="13 11 17 15 22 10"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  'arrow-right': '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  'star-fill': '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'at': '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>',
  paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  status: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'
};

function acIcon(name, size, cls, filled) {
  var inner = acIconMap[name] || '';
  var fill = filled ? ' fill="currentColor" stroke="currentColor"' : '';
  size = size || 18;
  return '<svg class="ac-icon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" width="' + size + '" height="' + size + '"' + fill + ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
}
window.acIcon = acIcon;

// ── Avatares (img o inicial) ────────────────────────────────────────
function acAvatarHtml(u, cls) {
  cls = cls || 'avatar avatar-md';
  var color = (u && u.avatar_color) || '#6C63FF';
  var name = (u && u.display_name) || '?';
  if (u && u.avatar_path) {
    return '<img src="' + escapeHtml(u.avatar_path) + '" class="' + cls + '" alt=""/>';
  }
  return '<span class="' + cls + '" style="background:' + color + '">' + escapeHtml(name.charAt(0).toUpperCase()) + '</span>';
}
function acGroupAvatarHtml(g, cls) {
  var color = acGroupColor(g);
  var letter = g && g.name && g.name.length ? g.name.charAt(0).toUpperCase() : '?';
  if (g && g.avatar_path) {
    return '<span class="' + cls + '" style="background:' + color + '"><img src="' + escapeHtml(g.avatar_path) + '" class="group-avatar-img" alt=""/></span>';
  }
  return '<span class="' + cls + '" style="background:' + color + '">' + escapeHtml(letter) + '</span>';
}
function acGroupColor(g) {
  if (!g || !g.name) return '#6C63FF';
  var h = 0;
  for (var i = 0; i < g.name.length; i++) h = (h * 31 + g.name.charCodeAt(i)) >>> 0;
  return '#' + (h % 0xFFFFFF).toString(16).padStart(6, '0');
}
function acInitialColor(name) {
  if (!name) return '#6C63FF';
  var h = 0;
  for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return '#' + (h % 0xFFFFFF).toString(16).padStart(6, '0');
}

// ── Subida de archivos a Storage (RLS: ruta empieza con mi id) ──────
function acUpload(bucket, path, file) {
  return AC.supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType: file.type || 'application/octet-stream',
  }).then(function (r) {
    if (r.error) throw r.error;
    return acPublicUrl(bucket, path);
  });
}
function acExt(fileName) {
  var i = String(fileName || '').lastIndexOf('.');
  return i === -1 ? 'bin' : fileName.slice(i + 1).toLowerCase();
}

// ── Inyecta el "shell" común (sidebar, modales, overlay de llamada) ─
function acInjectShell() {
  if (document.getElementById('sidebar')) return;
  var host = document.getElementById('sidebarMount');
  var wrap = document.createElement('div');
  wrap.innerHTML = acShellHtml();
  var nodes = Array.prototype.slice.call(wrap.childNodes);
  if (host && host.parentNode) {
    nodes.forEach(function (n) { host.parentNode.insertBefore(n, host); });
    host.parentNode.removeChild(host);
  } else {
    document.body.insertBefore(wrap, document.body.firstChild);
  }
  syncThemePills();
  var ds = document.getElementById('discoverSearch');
  if (ds) ds.addEventListener('input', acRenderSidebar);
}

function acShellHtml() {
  return '' +
  '<aside class="sidebar" id="sidebar">' +
    '<div class="sidebar-header">' +
      '<div class="sidebar-top-row">' +
        '<div class="sidebar-brand">' + acIcon('plane', 15) + ' AeroChat</div>' +
        '<div class="sidebar-top-actions">' +
          '<button class="sidebar-notify-btn" id="notifyBtn" onclick="acNotifyToggle()" title="Activar notificaciones" aria-label="Notificaciones">' + acIcon('bell', 16) + '</button>' +
          '<a href="requests.html" class="sidebar-req-link" id="requestsLink" title="Solicitudes de amistad">' + acIcon('users', 16) +
            '<span class="badge" id="requestBadge" hidden></span></a>' +
          '<button class="theme-toggle" onclick="toggleTheme()" title="Cambiar tema" aria-label="Cambiar tema">' +
            '<div class="theme-toggle-pill theme-pill-dark active">' + acIcon('moon', 13) + '</div>' +
            '<div class="theme-toggle-pill theme-pill-light">' + acIcon('sun', 13) + '</div>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<a href="profile.html?u={meId}" class="sidebar-me" id="sidebarMe">{meAvatar}' +
        '<div class="sidebar-me-info">' +
          '<div class="sidebar-me-name">{meName}</div>' +
          '<div class="sidebar-me-status"><span class="presence-dot online" data-userid="{meId}"></span>{meStatus}</div>' +
        '</div>' +
      '</a>' +
    '</div>' +
    '<div class="sidebar-scroll">' +
    '<div class="status-strip" id="statusStrip"></div>' +
    '<div class="sidebar-section-label">Amigos <span class="count" id="friendCount"></span>' +
      '<span class="unread-badge" id="totalUnread" hidden></span></div>' +
    '<div class="user-list sidebar-list" id="friendList"></div>' +
    '<div class="sidebar-section-label">Grupos' +
      '<button class="mini-btn mini-add mini-add-group" title="Nuevo grupo" onclick="openNewGroup()">' + acIcon('plus', 13) + '</button></div>' +
    '<div class="user-list sidebar-list" id="groupList"></div>' +
    '<div class="sidebar-section-label">Descubrir</div>' +
    '<input type="search" class="sidebar-search" id="discoverSearch" placeholder="Buscar usuarios…"/>' +
    '<div class="user-list sidebar-list" id="discoverList"></div>' +
    '</div>' +
    '<div class="sidebar-footer"><a href="javascript:logout()" class="btn-logout">' + acIcon('logout', 16) + '<span>Cerrar sesión</span></a></div>' +
  '</aside>' +
  '<div class="sidebar-overlay" id="sidebarOverlay" onclick="closeSidebar()"></div>' +
  '<div class="modal-overlay" id="newGroupModal">' +
    '<div class="modal">' +
      '<h3>Nuevo grupo</h3>' +
      '<div class="field"><label for="newGroupName">Nombre del grupo</label>' +
      '<input type="text" id="newGroupName" maxlength="40" placeholder="Ej: Salida de viernes"/></div>' +
      '<div class="field"><label>Amigos</label><div class="group-pick-list" id="newGroupMembers"></div></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="closeModal(\'newGroupModal\')">Cancelar</button>' +
        '<button type="button" class="btn btn-primary" onclick="createGroup()">Crear grupo</button>' +
      '</div>' +
    '</div>' +
  '</div>' +
  '<div class="modal-overlay" id="newStatusModal">' +
    '<div class="modal">' +
      '<h3>Nuevo estado</h3>' +
      '<div class="field"><label for="statusContent">Texto</label>' +
      '<textarea id="statusContent" class="edit-textarea" rows="2" placeholder="¿Qué estás haciendo?"></textarea></div>' +
      '<div class="new-status-media">' +
        '<button type="button" class="btn btn-ghost status-media-btn" onclick="openStatusEditor(\'photo\')">' + acIcon('image', 15) + ' Foto</button>' +
        '<button type="button" class="btn btn-ghost status-media-btn" onclick="openStatusEditor(\'video\')">' + acIcon('film', 15) + ' Video</button>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="closeModal(\'newStatusModal\')">Cancelar</button>' +
        '<button type="button" class="btn btn-primary" onclick="submitNewStatus()">Publicar texto</button>' +
      '</div>' +
    '</div>' +
  '</div>' +
  '<div id="callOverlay" class="call-overlay" hidden>' +
    '<div class="call-box">' +
      '<div class="call-videos" id="callVideos"></div>' +
      '<div class="call-info">' +
        '<span class="call-avatar" id="callAvatar"></span>' +
        '<div class="call-name" id="callName"></div>' +
        '<div class="call-state" id="callState">Llamando…</div>' +
        '<div class="call-timer" id="callTimer" hidden>00:00</div>' +
        '<div class="call-participants" id="callParticipants"></div>' +
      '</div>' +
      '<div class="call-actions">' +
        '<button class="call-btn call-accept" onclick="acceptIncoming()" title="Aceptar">' + acIcon('phone', 24) + '</button>' +
        '<button class="call-btn call-reject" onclick="declineIncoming()" title="Rechazar">' + acIcon('close', 24) + '</button>' +
        '<button class="call-btn call-cam" id="callCam" onclick="toggleCam()" title="Cámara">' + acIcon('camera', 22) + '</button>' +
        '<button class="call-btn call-mute" id="callMute" onclick="toggleMute()" title="Silenciar">' + acIcon('mic', 22) + '</button>' +
        '<button class="call-btn call-invite" id="callInvite" onclick="openCallInvite()" title="Invitar">' + acIcon('users', 22) + '</button>' +
        '<button class="call-btn call-hangup" onclick="hangupCall()" title="Colgar">' + acIcon('phone-down', 22) + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="call-invite-modal" id="callInviteModal" hidden>' +
      '<div class="call-invite-head">Invitar a amigos</div>' +
      '<div class="call-invite-list" id="callInviteList"></div>' +
      '<button type="button" class="btn btn-ghost btn-invite-close" onclick="document.getElementById(\'callInviteModal\').hidden = true">Cerrar</button>' +
    '</div>' +
  '</div>';
}

// ── Sidebar: carga + render ─────────────────────────────────────────
function acLoadSidebar() {
  return acGetSidebar().then(function (data) {
    if (!data) return null;
    AC.me = data.me || null;
    AC.users = data.users || [];
    AC.groups = data.groups || [];
    AC.unread = data.unread || {};
    AC.usersById = {};
    AC.users.forEach(function (u) { AC.usersById[u.id] = u; });
    acRenderSidebar();
    loadStatusStrip();
    applyPresence();
    return data;
  });
}

function acRefreshSidebar() {
  if (AC.sidebarTimer) clearTimeout(AC.sidebarTimer);
  AC.sidebarTimer = setTimeout(function () { acLoadSidebar(); }, 250);
}

function acRenderSidebar() {
  // ── Yo ──
  var meHtml = document.getElementById('sidebarMe');
  if (meHtml) {
    var avatar = AC.me ? acAvatarHtml(AC.me, 'avatar avatar-md') : '<span class="avatar avatar-md"></span>';
    var name = AC.me ? AC.me.display_name : '';
    var status = AC.me && AC.me.status ? AC.me.status : 'Mi perfil';
    meHtml.setAttribute('href', 'profile.html?u=' + (AC.me ? AC.me.id : ''));
    meHtml.innerHTML = avatar +
      '<div class="sidebar-me-info"><div class="sidebar-me-name">' + escapeHtml(name) + '</div>' +
      '<div class="sidebar-me-status"><span class="presence-dot online" data-userid="' + (AC.me ? AC.me.id : '') + '"></span>' +
      escapeHtml(status) + '</div></div>';
  }

  var requests = AC.users.filter(function (u) { return u.friend_state === 'incoming'; });
  var friends = AC.users.filter(function (u) { return u.friend_state === 'friends'; });

  // ── Solicitudes (badge → página requests.html) ──
  var reqBadge = document.getElementById('requestBadge');
  if (reqBadge) { reqBadge.hidden = requests.length === 0; reqBadge.textContent = requests.length; }

  // ── Amigos ──
  var friendCount = document.getElementById('friendCount');
  if (friendCount) friendCount.textContent = friends.length;
  var total = Object.keys(AC.unread).reduce(function (a, k) { return a + (AC.unread[k] || 0); }, 0);
  var totalEl = document.getElementById('totalUnread');
  if (totalEl) { totalEl.hidden = total === 0; totalEl.textContent = total; }
  var friendList = document.getElementById('friendList');
  if (friendList) {
    friendList.innerHTML = friends.map(function (u) {
      var isActive = AC.view && AC.view.kind === 'direct' && AC.view.id === u.id;
      var unread = AC.unread[u.id] || 0;
      return '<a href="conversation.html?u=' + u.id + '" class="user-item' + (isActive ? ' active' : '') + '">' +
        '<span class="avatar-wrap">' + acAvatarHtml(u, 'avatar avatar-md') +
        '<span class="presence-dot" data-userid="' + u.id + '"></span></span>' +
        '<div class="user-item-info"><span class="user-item-name">' + escapeHtml(u.display_name) + '</span>' +
        '<span class="user-item-sub">' + escapeHtml(u.status || ('@' + u.username)) + '</span></div>' +
        (unread > 0 ? '<span class="unread-badge">' + unread + '</span>' : '') +
        '</a>';
    }).join('') ||
      '<div class="sidebar-empty">Todavía no tenés amigos.<br/>Agregá contactos con el botón ＋.</div>';
  }

  // ── Grupos ──
  var groupList = document.getElementById('groupList');
  if (groupList) {
    groupList.innerHTML = AC.groups.map(function (g) {
      var isActive = AC.view && AC.view.kind === 'group' && AC.view.id === g.id;
      var unread = AC.unread[g.id] || 0;
      var count = (g.member_ids || []).length;
      return '<a href="group.html?id=' + g.id + '" class="user-item' + (isActive ? ' active' : '') + '">' +
        acGroupAvatarHtml(g, 'group-avatar') +
        '<div class="user-item-info"><span class="user-item-name">' + escapeHtml(g.name) + '</span>' +
        '<span class="user-item-sub">' + count + ' ' + (count === 1 ? 'miembro' : 'miembros') + '</span></div>' +
        (unread > 0 ? '<span class="unread-badge">' + unread + '</span>' : '') +
        '</a>';
    }).join('') ||
      '<div class="sidebar-empty">Todavía no hay grupos.<br/>Creá uno con tus amigos.</div>';
  }

  // ── Descubrir ──
  var discoverList = document.getElementById('discoverList');
  if (discoverList) {
    var ds = document.getElementById('discoverSearch');
    var q = ds ? ds.value.trim().toLowerCase() : '';
    var discover = q
      ? AC.users.filter(function (u) {
          return (u.username && u.username.toLowerCase().indexOf(q) >= 0) ||
                 (u.display_name && u.display_name.toLowerCase().indexOf(q) >= 0);
        })
      : AC.users.filter(function (u) { return u.friend_state === 'none' || u.friend_state === 'outgoing'; });
    discoverList.innerHTML = discover.map(function (u) {
      return '<a href="conversation.html?u=' + u.id + '" class="user-item">' +
        acAvatarHtml(u, 'avatar avatar-md') +
        '<div class="user-item-info"><span class="user-item-name">' + escapeHtml(u.display_name) + '</span>' +
        '<span class="user-item-sub">' + escapeHtml(u.status || ('@' + u.username)) + '</span></div>' +
        acDiscoverAction(u) +
        '</a>';
    }).join('') ||
      '<div class="sidebar-empty">' + (q ? 'No se encontraron usuarios.' : 'Sin usuarios por descubrir.') + '</div>';
  }
}

// Acción según el estado de amistad en Descubrir / búsqueda.
function acDiscoverAction(u) {
  if (u.friend_state === 'outgoing') {
    return '<span class="mini-btn pending" title="Solicitud enviada" onclick="event.preventDefault()">' + acIcon('clock', 13) + '</span>';
  }
  if (u.friend_state === 'incoming') {
    return '<button class="mini-btn mini-accept" title="Aceptar solicitud" onclick="event.preventDefault();acceptRequest(\'' + u.id + '\',\'' + (u.request_id || '') + '\',this)">' + acIcon('check', 13) + '</button>';
  }
  if (u.friend_state === 'friends') {
    return '<span class="mini-btn pending" title="Ya son amigos" onclick="event.preventDefault()">' + acIcon('check', 13) + '</span>';
  }
  return '<span class="mini-btn mini-add" title="Agregar amigo" onclick="event.preventDefault();sendFriendRequest(\'' + u.id + '\')">' + acIcon('plus', 13) + '</span>';
}

// ── Acciones de amistad ─────────────────────────────────────────────
function sendFriendRequest(userId) {
  acSendFriendRequest(userId).then(function (status) {
    if (status === 'sent') { showToast('Solicitud de amistad enviada.', 'success'); }
    else if (status === 'pending') { showToast('Ya le enviaste una solicitud.'); }
    else if (status === 'friends') { showToast('Ya son amigos.'); }
    else if (status === 'incoming') { showToast('Ese usuario ya te envió una solicitud. Revisá la sección Solicitudes.'); }
    else { showToast('No se pudo enviar la solicitud.'); }
    acRefreshSidebar();
  });
}
function acceptRequest(fromId, reqId, btn) {
  if (btn) btn.disabled = true;
  AC.suppressFriendshipToast = true;
  setTimeout(function () { AC.suppressFriendshipToast = false; }, 3000);
  acAcceptFriendRequest(reqId).then(function (other) {
    if (!other) { showToast('No se pudo aceptar la solicitud.'); return; }
    showToast('Solicitud aceptada. ¡Ahora son amigos!', 'success');
    acRefreshSidebar();
    renderProfileFriendActions('friends');
  });
}
function declineRequest(fromId, reqId, btn) {
  if (btn) btn.disabled = true;
  acDeclineFriendRequest(reqId).then(function () {
    showToast('Solicitud rechazada.');
    acRefreshSidebar();
    renderProfileFriendActions('none');
  });
}
function cancelRequest(toId) {
  acCancelFriendRequest(toId).then(function () {
    showToast('Solicitud cancelada.');
    acRefreshSidebar();
    renderProfileFriendActions('none');
  });
}
function removeFriend(friendId) {
  if (!confirm('¿Eliminar a este amigo de tu lista?')) return;
  AC.suppressFriendshipToast = true;
  setTimeout(function () { AC.suppressFriendshipToast = false; }, 3000);
  acRemoveFriend(friendId).then(function () {
    showToast('Amigo eliminado.');
    acRefreshSidebar();
    renderProfileFriendActions('none');
  });
}

// ── Botones de amistad en el perfil ─────────────────────────────────
function renderProfileFriendActions(state) {
  var wrap = document.getElementById('profileFriendActions');
  if (!wrap || wrap.getAttribute('data-isown') === '1') return;
  var id = wrap.getAttribute('data-userid');
  var reqId = wrap.getAttribute('data-requestid') || '';
  var html = '';
  if (state === 'friends') {
    html = '<a href="conversation.html?u=' + id + '" class="btn btn-primary">' + acIcon('message-circle', 15) + ' Mensaje</a>' +
      '<button type="button" class="btn btn-secondary" onclick="removeFriend(\'' + id + '\')">Eliminar amigo</button>';
  } else if (state === 'incoming') {
    html = '<button type="button" class="btn btn-primary" onclick="acceptRequest(\'' + id + '\',\'' + reqId + '\',this)">' + acIcon('check', 15) + ' Aceptar solicitud</button>' +
      '<button type="button" class="btn btn-ghost" onclick="declineRequest(\'' + id + '\',\'' + reqId + '\',this)">Rechazar</button>';
  } else if (state === 'outgoing') {
    html = '<button type="button" class="btn btn-secondary" disabled>Solicitud enviada</button>' +
      '<button type="button" class="btn btn-ghost" onclick="cancelRequest(\'' + id + '\')">Cancelar</button>';
  } else {
    html = '<button type="button" class="btn btn-primary" onclick="sendFriendRequest(\'' + id + '\')">' + acIcon('plus', 15) + ' Agregar amigo</button>';
  }
  wrap.innerHTML = html;
}

// ── Nuevo grupo ─────────────────────────────────────────────────────
function openNewGroup() {
  var list = document.getElementById('newGroupMembers');
  if (!list) return;
  list.innerHTML = 'Cargando amigos…';
  closeModal('newGroupModal');
  acGetFriends().then(function (friends) {
    if (!friends || !friends.length) {
      list.innerHTML = '<div class="sidebar-empty">No tenés amigos todavía.<br/>Agregá amigos para crear un grupo.</div>';
    } else {
      list.innerHTML = friends.map(function (f) {
        return '<label class="group-pick-item">' +
          '<input type="checkbox" value="' + f.id + '"/>' +
          '<span class="avatar-wrap">' + acAvatarHtml(f, 'avatar avatar-sm') + '</span>' +
          '<span class="group-pick-name">' + escapeHtml(f.display_name) + '</span>' +
          '</label>';
      }).join('');
    }
    openModal('newGroupModal');
  }).catch(function () {
    list.innerHTML = '<div class="sidebar-empty">No se pudieron cargar tus amigos.</div>';
    openModal('newGroupModal');
  });
}
function createGroup() {
  var name = (document.getElementById('newGroupName').value || '').trim();
  var ids = Array.prototype.slice.call(document.querySelectorAll('#newGroupMembers input:checked')).map(function (c) { return c.value; });
  if (!name) { showToast('Escribí un nombre para el grupo.'); return; }
  acCreateGroup(name, ids).then(function (g) {
    if (!g) { showToast('No se pudo crear el grupo.'); return; }
    showToast('Grupo creado.', 'success');
    location.href = 'group.html?id=' + g.id;
  });
}

// ── Tira de estados ─────────────────────────────────────────────────
function openNewStatus() { openModal('newStatusModal'); }
function openStatusEditor(kind) {
  var t = document.getElementById('statusContent');
  try { localStorage.setItem('ac-status-draft', (t ? t.value.trim() : '')); } catch (e) {}
  closeModal('newStatusModal');
  location.href = 'status-editor.html?type=' + (kind === 'video' ? 'video' : 'photo');
}
function loadStatusStrip() {
  var wrap = document.getElementById('statusStrip');
  if (!wrap) return;
  acGetVisibleStatuses().then(function (statuses) {
    statuses = statuses || [];
    var me = AC.me;
    var myStatuses = me ? statuses.filter(function (s) { return s.user_id === me.id; }) : [];
    var groups = {};
    statuses.forEach(function (s) {
      if (s.user_id === (me && me.id)) return;
      if (!groups[s.user_id]) groups[s.user_id] = { userId: s.user_id, userName: s.user_name, userColor: s.user_color, userAvatar: s.user_avatar, items: [] };
      groups[s.user_id].items.push(s);
    });
    var html = '<div class="status-strip-item" title="Mi estado">' +
      '<a class="status-ring' + (myStatuses.length ? ' has-status' : '') + '" href="status.html">' +
      (me ? acAvatarHtml(me, 'avatar avatar-md') : '') +
      '<span class="status-strip-add">' + acIcon('plus', 11) + '</span></a>' +
      '<span class="status-strip-name">Mi estado</span>' +
      '<a class="status-strip-edit" href="status-editor.html?type=photo" title="Crear estado">' + acIcon('plus', 12) + '</a></div>';
    Object.keys(groups).forEach(function (uid) {
      var g = groups[uid];
      var last = g.items[g.items.length - 1];
      var preview = last && last.type === 'image' ? 'Foto' : (last && last.type === 'video' ? 'Video' : (last ? last.content : ''));
      html += '<div class="status-strip-item" title="' + escapeHtml(g.userName) + ': ' + escapeHtml(preview) + '">' +
        '<a class="status-ring has-status" href="status.html?u=' + uid + '">' +
        (g.userAvatar ? '<img src="' + escapeHtml(g.userAvatar) + '" class="avatar avatar-md" alt=""/>'
                      : '<span class="avatar avatar-md" style="background:' + g.userColor + '">' + escapeHtml((g.userName || '?').charAt(0).toUpperCase()) + '</span>') +
        '</a><span class="status-strip-name">' + escapeHtml(g.userName) + '</span></div>';
    });
    if (!Object.keys(groups).length && !myStatuses.length) {
      html += '<div class="status-strip-hint">Tus estados y los de tus amigos aparecen acá</div>';
    }
    wrap.innerHTML = html;
  }).catch(function (e) { console.error('AeroChat: no se pudo cargar estados', e); });
}

function submitNewStatus() {
  var content = (document.getElementById('statusContent').value || '').trim();
  if (!content) { showToast('Escribí algo para publicar un estado de texto.'); return; }
  var btn = document.querySelector('#newStatusModal .btn-primary');
  var old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  acAddStatus(content, 'text', null, null)
    .then(function () {
      closeModal('newStatusModal');
      document.getElementById('statusContent').value = '';
      showToast('Estado publicado.', 'success');
      loadStatusStrip();
    })
    .catch(function (e) {
      console.error(e);
      showToast('No se pudo publicar el estado.', 'error');
    })
    .then(function () {
      if (btn) { btn.disabled = false; btn.textContent = old; }
    });
}

// ── Sesión / logout ─────────────────────────────────────────────────
function acInitApp(cb) {
  AC.supabase.auth.getSession().then(function (r) {
    var session = r.data && r.data.session;
    if (!session) { location.replace('index.html'); return; }
    AC.session = session;
    AC.authUser = session.user;
    document.body.setAttribute('data-userid', AC.authUser.id);
    document.body.setAttribute('data-name', session.user.user_metadata && session.user.user_metadata.display_name || '');
    acInjectShell();
    if (typeof updateNotifyBtn === 'function') updateNotifyBtn();
    acInitRealtime();            // realtime.js
    acLoadSidebar().then(function () {
      applyPresence();
      if (cb) cb();
    });
  });
}
function logout() {
  AC.supabase.auth.signOut().then(function () { location.href = 'index.html'; });
}

// Limpieza al salir de la página (presencia + canales).
function acTeardown() {
  AC.channels.forEach(function (ch) {
    try { if (ch.presence && ch.presence.untrack) ch.presence.untrack(); } catch (e) {}
    try { ch.unsubscribe(); } catch (e) {}
  });
  AC.channels = [];
}
window.addEventListener('pagehide', acTeardown);
