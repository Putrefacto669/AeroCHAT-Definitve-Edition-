// ═══════════════════════════════════════════════════════════════════
//  AeroChat · notify.js (notificaciones del navegador)
//  ------------------------------------------------------------------
//  Usa la Notification API: se pide permiso al usuario (siempre dentro
//  de un gesto: login o el botón de campana del sidebar) y muestra
//  notificaciones de mensajes nuevos solo cuando la pestaña no está
//  enfocada. Al hacer click en la notificación se abre la conversación.
//  ═══════════════════════════════════════════════════════════════════

var AC_NOTIFY_KEY = 'ac-notify-enabled';

function acNotifySupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function acNotifyEnabled() {
  try { return localStorage.getItem(AC_NOTIFY_KEY) === '1'; } catch (e) { return false; }
}

function acNotifySetEnabled(on) {
  try { localStorage.setItem(AC_NOTIFY_KEY, on ? '1' : '0'); } catch (e) {}
}

// Pedir permiso al navegador. Llamar siempre dentro de un gesto del usuario.
function acNotifyRequest() {
  if (!acNotifySupported()) return Promise.resolve('unsupported');
  if (Notification.permission === 'granted') return Promise.resolve('granted');
  if (Notification.permission === 'denied') return Promise.resolve('denied');
  return Notification.requestPermission();
}

// Activar/desactivar notificaciones (botón campana del sidebar).
function acNotifyToggle() {
  if (!acNotifySupported()) { showToast('Tu navegador no soporta notificaciones.'); return; }
  if (acNotifyEnabled()) {
    acNotifySetEnabled(false);
    updateNotifyBtn();
    showToast('Notificaciones desactivadas.');
    return;
  }
  acNotifyRequest().then(function (perm) {
    if (perm === 'granted') {
      acNotifySetEnabled(true);
      updateNotifyBtn();
      showToast('Notificaciones activadas.', 'success');
    } else if (perm === 'denied') {
      showToast('Permiso denegado. Habilitalo en los ajustes del navegador.', 'error');
    } else {
      showToast('Permiso no otorgado. Tocá la campana para intentar de nuevo.', 'info');
    }
  });
}

// Pedir permiso una vez al iniciar sesión (gesto de usuario en el login).
function acNotifyAskOnLogin() {
  if (!acNotifySupported()) return;
  if (acNotifyEnabled() || Notification.permission !== 'default') return;
  acNotifyRequest().then(function (perm) {
    if (perm === 'granted') {
      acNotifySetEnabled(true);
      try { localStorage.setItem('ac-notify-asked', '1'); } catch (e) {}
    }
  });
}

function updateNotifyBtn() {
  var b = document.getElementById('notifyBtn');
  if (!b) return;
  var on = acNotifyEnabled();
  b.classList.toggle('on', on);
  b.title = on ? 'Notificaciones activadas' : 'Activar notificaciones';
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function notifyMediaLabel(type) {
  if (!type || type === 'text') return null;
  if (type === 'gif') return 'un GIF';
  if (type === 'image') return 'una foto';
  if (type === 'audio') return 'una nota de voz';
  if (type === 'video') return 'un video';
  if (type === 'sticker') return 'un sticker';
  return 'un archivo';
}

// Mostrar notificación de mensaje nuevo (solo pestaña sin foco).
function acNotifyMessage(m) {
  if (!acNotifySupported() || !acNotifyEnabled()) return;
  if (Notification.permission !== 'granted') return;
  if (!document.hidden && document.hasFocus()) return;
  if (!AC.authUser || !m || m.sender_id === AC.authUser.id) return;
  if (m.is_deleted) return;

  var lbl = notifyMediaLabel(m.type);
  var content = lbl ? ('[' + lbl + ']') : String(m.content || '').trim();
  if (!content) return;
  if (content.length > 90) content = content.slice(0, 90) + '…';

  var title, body, url, icon;
  if (m.scope === 'direct') {
    var sender = (AC.usersById && AC.usersById[m.sender_id]) || null;
    title = sender && sender.display_name ? sender.display_name : 'Nuevo mensaje';
    body = content;
    url = 'conversation.html?u=' + m.sender_id;
    icon = sender && sender.avatar_path ? sender.avatar_path : '';
  } else if (m.scope === 'group') {
    var g = null;
    if (AC.groups) for (var i = 0; i < AC.groups.length; i++) {
      if (AC.groups[i].id === m.receiver_id) { g = AC.groups[i]; break; }
    }
    var sname = (AC.usersById && AC.usersById[m.sender_id] && AC.usersById[m.sender_id].display_name) || 'Alguien';
    title = g && g.name ? g.name : 'Grupo';
    body = sname + ': ' + content;
    url = 'group.html?id=' + m.receiver_id;
    icon = g && g.avatar_path ? g.avatar_path : '';
  } else {
    return;
  }

  var opts = { body: body, tag: url };
  if (icon) opts.icon = icon;

  try {
    var n = new Notification(title, opts);
    n.onclick = function () {
      try { window.focus(); } catch (e) {}
      location.href = url;
      try { n.close(); } catch (e2) {}
    };
  } catch (e) {}
}
