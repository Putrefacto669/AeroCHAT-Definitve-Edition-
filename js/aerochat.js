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
}

function acShellHtml() {
  return '' +
  '<aside class="sidebar" id="sidebar">' +
    '<div class="sidebar-header">' +
      '<div class="sidebar-top-row">' +
        '<div class="sidebar-brand"><div class="sidebar-brand-icon">✈</div> AeroChat</div>' +
        '<button class="theme-toggle" onclick="toggleTheme()" title="Cambiar tema" aria-label="Cambiar tema">' +
          '<div class="theme-toggle-pill theme-pill-dark active">🌙</div>' +
          '<div class="theme-toggle-pill theme-pill-light">☀️</div>' +
        '</button>' +
      '</div>' +
      '<a href="profile.html?u={meId}" class="sidebar-me" id="sidebarMe">{meAvatar}' +
        '<div class="sidebar-me-info">' +
          '<div class="sidebar-me-name">{meName}</div>' +
          '<div class="sidebar-me-status"><span class="presence-dot online" data-userid="{meId}"></span>{meStatus}</div>' +
        '</div>' +
      '</a>' +
    '</div>' +
    '<div class="status-strip" id="statusStrip"></div>' +
    '<div class="sidebar-section-label">Solicitudes <span class="badge" id="requestBadge" hidden></span></div>' +
    '<div class="user-list sidebar-list" id="requestList"></div>' +
    '<div class="sidebar-section-label">Amigos <span class="count" id="friendCount"></span>' +
      '<span class="unread-badge" id="totalUnread" hidden></span></div>' +
    '<div class="user-list sidebar-list" id="friendList"></div>' +
    '<div class="sidebar-section-label">Grupos' +
      '<button class="mini-btn mini-add mini-add-group" title="Nuevo grupo" onclick="openNewGroup()">＋</button></div>' +
    '<div class="user-list sidebar-list" id="groupList"></div>' +
    '<div class="sidebar-section-label">Descubrir</div>' +
    '<div class="user-list sidebar-list" id="discoverList"></div>' +
    '<div class="sidebar-footer"><a href="javascript:logout()" class="btn-logout"><span>↩</span> Cerrar sesión</a></div>' +
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
      '<textarea id="statusContent" class="edit-textarea" rows="3" placeholder="¿Qué estás haciendo?"></textarea></div>' +
      '<div class="field"><label class="avatar-change-label">🖼 Agregar foto' +
      '<input type="file" id="statusImage" accept="image/*"/></label></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="closeModal(\'newStatusModal\')">Cancelar</button>' +
        '<button type="button" class="btn btn-primary" onclick="submitNewStatus()">Publicar</button>' +
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
        '<button class="call-btn call-accept" onclick="acceptIncoming()" title="Aceptar">📞</button>' +
        '<button class="call-btn call-reject" onclick="declineIncoming()" title="Rechazar">✕</button>' +
        '<button class="call-btn call-cam" id="callCam" onclick="toggleCam()" title="Cámara">🎥</button>' +
        '<button class="call-btn call-mute" id="callMute" onclick="toggleMute()" title="Silenciar">🎙</button>' +
        '<button class="call-btn call-invite" id="callInvite" onclick="openCallInvite()" title="Invitar">👥</button>' +
        '<button class="call-btn call-hangup" onclick="hangupCall()" title="Colgar">📵</button>' +
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
  var discover = AC.users.filter(function (u) { return u.friend_state === 'none' || u.friend_state === 'outgoing'; });

  // ── Solicitudes ──
  var reqBadge = document.getElementById('requestBadge');
  if (reqBadge) { reqBadge.hidden = requests.length === 0; reqBadge.textContent = requests.length; }
  var reqList = document.getElementById('requestList');
  if (reqList) {
    reqList.innerHTML = requests.map(function (u) {
      return '<div class="req-item" data-req-from="' + u.id + '">' + acAvatarHtml(u, 'avatar avatar-md') +
        '<div class="user-item-info"><span class="user-item-name">' + escapeHtml(u.display_name) + '</span>' +
        '<span class="user-item-sub">Quiere ser tu amigo</span></div>' +
        '<div class="req-actions">' +
        '<button class="mini-btn mini-accept" title="Aceptar" onclick="acceptRequest(\'' + u.id + '\',\'' + (u.request_id || '') + '\',this)">✓</button>' +
        '<button class="mini-btn mini-decline" title="Rechazar" onclick="declineRequest(\'' + u.id + '\',\'' + (u.request_id || '') + '\',this)">✕</button>' +
        '</div></div>';
    }).join('') ||
      '<div class="sidebar-empty">Todavía no tenés amigos.<br/>Agregá contactos con el botón ＋.</div>';
  }

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
    discoverList.innerHTML = discover.map(function (u) {
      return '<a href="conversation.html?u=' + u.id + '" class="user-item">' +
        acAvatarHtml(u, 'avatar avatar-md') +
        '<div class="user-item-info"><span class="user-item-name">' + escapeHtml(u.display_name) + '</span>' +
        '<span class="user-item-sub">' + escapeHtml(u.status || ('@' + u.username)) + '</span></div>' +
        (u.friend_state === 'outgoing'
          ? '<span class="mini-btn pending" title="Solicitud enviada" onclick="event.preventDefault()">⏳</span>'
          : '<span class="mini-btn mini-add" title="Agregar amigo" onclick="event.preventDefault();sendFriendRequest(\'' + u.id + '\')">＋</span>') +
        '</a>';
    }).join('') || '';
  }
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
    html = '<a href="conversation.html?u=' + id + '" class="btn btn-primary">💬 Mensaje</a>' +
      '<button type="button" class="btn btn-secondary" onclick="removeFriend(\'' + id + '\')">Eliminar amigo</button>';
  } else if (state === 'incoming') {
    html = '<button type="button" class="btn btn-primary" onclick="acceptRequest(\'' + id + '\',\'' + reqId + '\',this)">✓ Aceptar solicitud</button>' +
      '<button type="button" class="btn btn-ghost" onclick="declineRequest(\'' + id + '\',\'' + reqId + '\',this)">Rechazar</button>';
  } else if (state === 'outgoing') {
    html = '<button type="button" class="btn btn-secondary" disabled>Solicitud enviada</button>' +
      '<button type="button" class="btn btn-ghost" onclick="cancelRequest(\'' + id + '\')">Cancelar</button>';
  } else {
    html = '<button type="button" class="btn btn-primary" onclick="sendFriendRequest(\'' + id + '\')">＋ Agregar amigo</button>';
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
    var html = '<a class="status-strip-item" href="status.html" title="Mi estado">' +
      '<span class="status-ring' + (myStatuses.length ? ' has-status' : '') + '">' +
      (me ? acAvatarHtml(me, 'avatar avatar-md') : '') +
      '<span class="status-strip-add">＋</span></span>' +
      '<span class="status-strip-name">Mi estado</span></a>';
    Object.keys(groups).forEach(function (uid) {
      var g = groups[uid];
      var last = g.items[g.items.length - 1];
      var preview = last && last.type === 'image' ? '📷 foto' : (last ? last.content : '');
      html += '<a class="status-strip-item" href="status.html?u=' + uid + '" title="' + escapeHtml(g.userName) + ': ' + escapeHtml(preview) + '">' +
        '<span class="status-ring has-status">' +
        (g.userAvatar ? '<img src="' + escapeHtml(g.userAvatar) + '" class="avatar avatar-md" alt=""/>'
                      : '<span class="avatar avatar-md" style="background:' + g.userColor + '">' + escapeHtml((g.userName || '?').charAt(0).toUpperCase()) + '</span>') +
        '</span><span class="status-strip-name">' + escapeHtml(g.userName) + '</span></a>';
    });
    if (!Object.keys(groups).length && !myStatuses.length) {
      html += '<div class="status-strip-hint">Tus estados y los de tus amigos aparecen acá</div>';
    }
    wrap.innerHTML = html;
  }).catch(function (e) { console.error('AeroChat: no se pudo cargar estados', e); });
}

function submitNewStatus() {
  var content = (document.getElementById('statusContent').value || '').trim();
  var fileInput = document.getElementById('statusImage');
  var file = fileInput && fileInput.files && fileInput.files[0];
  var btn = document.querySelector('#newStatusModal .btn-primary');
  var old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  var doAdd = function (type, path, name) {
    return acAddStatus(type === 'image' ? '' : content, type, path || null, name || null);
  };
  var promise;
  if (file) {
    var path = AC.authUser.id + '/status-' + acRandomId() + '.' + acExt(file.name);
    promise = acUpload('statuses', path, file).then(function (url) { return doAdd('image', url, file.name); });
  } else if (content) {
    promise = doAdd('text', null, null);
  } else {
    showToast('Escribí algo o elegí una foto.');
    if (btn) { btn.disabled = false; btn.textContent = old; }
    return;
  }
  promise.then(function () {
    closeModal('newStatusModal');
    document.getElementById('statusContent').value = '';
    if (fileInput) fileInput.value = '';
    showToast('Estado publicado.', 'success');
    loadStatusStrip();
  }).catch(function (e) {
    console.error(e);
    showToast('No se pudo publicar el estado.', 'error');
  }).then(function () {
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
