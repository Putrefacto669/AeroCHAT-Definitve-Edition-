// ═══════════════════════════════════════════════════════════════════
//  AeroChat · requests.js (página de solicitudes de amistad)
//  ------------------------------------------------------------------
//  Página requests.html: muestra las solicitudes pendientes (aceptar /
//  rechazar) y las enviadas (cancelar). Se actualiza en vivo vía
//  Realtime (hook window.reqOnNewRequest definido en realtime.js).
//  ═══════════════════════════════════════════════════════════════════

var reqPending = [];
var reqSent = [];

function reqLoad() {
  return acGetSidebar().then(function (data) {
    if (!data) return null;
    AC.users = data.users || [];
    AC.usersById = {};
    AC.users.forEach(function (u) { AC.usersById[u.id] = u; });
    reqPending = AC.users.filter(function (u) { return u.friend_state === 'incoming'; });
    reqSent = AC.users.filter(function (u) { return u.friend_state === 'outgoing'; });
    reqRender();
    return data;
  });
}

function reqCardHtml(u, kind) {
  var isPending = kind === 'pending';
  var btn;
  if (isPending) {
    btn = '<button class="btn btn-primary req-btn" onclick="reqAccept(\'' + u.id + '\',\'' + (u.request_id || '') + '\',this)">' + acIcon('check', 15) + ' Aceptar</button>' +
          '<button class="btn btn-ghost req-btn" onclick="reqDecline(\'' + u.id + '\',\'' + (u.request_id || '') + '\',this)">' + acIcon('close', 15) + ' Rechazar</button>';
  } else {
    btn = '<button class="btn btn-ghost req-btn" onclick="reqCancel(\'' + u.id + '\',this)">' + acIcon('close', 15) + ' Cancelar</button>';
  }
  return '<div class="req-card" data-req-id="' + (u.request_id || '') + '">' +
    '<a class="req-card-avatar" href="profile.html?u=' + u.id + '">' + acAvatarHtml(u, 'avatar avatar-md') + '</a>' +
    '<div class="req-card-info">' +
      '<a class="req-card-name" href="profile.html?u=' + u.id + '">' + escapeHtml(u.display_name) + '</a>' +
      '<span class="req-card-sub">' + escapeHtml(u.status || ('@' + u.username)) + '</span>' +
      '<span class="req-card-tag">' + (isPending ? 'Quiere ser tu amigo' : 'Solicitud enviada') + '</span>' +
    '</div>' +
    '<div class="req-card-actions">' + btn + '</div>' +
  '</div>';
}

function reqRender() {
  var pc = document.getElementById('pendingCount');
  if (pc) { pc.hidden = reqPending.length === 0; pc.textContent = reqPending.length; }
  var sc = document.getElementById('sentCount');
  if (sc) sc.textContent = reqSent.length;

  var pl = document.getElementById('pendingList');
  if (pl) {
    pl.innerHTML = reqPending.map(function (u) { return reqCardHtml(u, 'pending'); }).join('') ||
      '<div class="req-empty">No tenés solicitudes pendientes.<br/>Los usuarios que te agreguen van a aparecer acá.</div>';
  }

  var sl = document.getElementById('sentList');
  if (sl) {
    sl.innerHTML = reqSent.map(function (u) { return reqCardHtml(u, 'sent'); }).join('') ||
      '<div class="req-empty">No enviaste solicitudes todavía.<br/>Buscá usuarios en la sección de arriba.</div>';
  }

  reqDiscover();
}

// ── Agregar amigos (búsqueda sobre el directorio de usuarios) ────────
function reqDiscover() {
  var wrap = document.getElementById('discoverReqList');
  if (!wrap) return;
  var inp = document.getElementById('discoverReqSearch');
  var q = (inp && inp.value || '').trim().toLowerCase();
  var users = (AC.users || []).filter(function (u) {
    if (u.friend_state === 'friends' || u.friend_state === 'incoming' || u.friend_state === 'outgoing') return false;
    if (!q) return true;
    return (u.username && u.username.toLowerCase().indexOf(q) >= 0) ||
           (u.display_name && u.display_name.toLowerCase().indexOf(q) >= 0);
  });
  if (!users.length) {
    wrap.innerHTML = '<div class="req-empty">' + (q ? 'No se encontraron usuarios.' : 'No hay usuarios por agregar.') + '</div>';
    return;
  }
  wrap.innerHTML = users.map(function (u) {
    return '<div class="req-card">' +
      '<a class="req-card-avatar" href="profile.html?u=' + u.id + '">' + acAvatarHtml(u, 'avatar avatar-md') + '</a>' +
      '<div class="req-card-info">' +
        '<a class="req-card-name" href="profile.html?u=' + u.id + '">' + escapeHtml(u.display_name) + '</a>' +
        '<span class="req-card-sub">' + escapeHtml(u.status || ('@' + u.username)) + '</span>' +
      '</div>' +
      '<div class="req-card-actions">' +
        '<button class="btn btn-primary req-btn" onclick="reqSend(\'' + u.id + '\',this)">' + acIcon('plus', 15) + ' Agregar</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function reqSend(toId, btn) {
  if (btn) btn.disabled = true;
  acSendFriendRequest(toId).then(function (status) {
    if (status === 'sent') showToast('Solicitud de amistad enviada.', 'success');
    else if (status === 'pending') showToast('Ya le enviaste una solicitud.');
    else if (status === 'friends') showToast('Ya son amigos.');
    else if (status === 'incoming') showToast('Ese usuario ya te envió una solicitud. Aceptala en Pendientes.');
    else showToast('No se pudo enviar la solicitud.', 'error');
    acRefreshSidebar();
    reqLoad();
  }).catch(function (e) {
    if (btn) btn.disabled = false;
    acToastError(e, 'No se pudo enviar la solicitud.');
  });
}

function reqAccept(fromId, reqId, btn) {
  if (btn) btn.disabled = true;
  AC.suppressFriendshipToast = true;
  setTimeout(function () { AC.suppressFriendshipToast = false; }, 3000);
  acAcceptFriendRequest(reqId).then(function (other) {
    if (!other) { showToast('No se pudo aceptar la solicitud.', 'error'); if (btn) btn.disabled = false; return; }
    showToast('Solicitud aceptada. ¡Ahora son amigos!', 'success');
    acRefreshSidebar();
    reqLoad();
  }).catch(function (e) {
    if (btn) btn.disabled = false;
    acToastError(e, 'No se pudo aceptar la solicitud.');
  });
}
function reqDecline(fromId, reqId, btn) {
  if (btn) btn.disabled = true;
  acDeclineFriendRequest(reqId).then(function () {
    showToast('Solicitud rechazada.');
    acRefreshSidebar();
    reqLoad();
  }).catch(function (e) {
    if (btn) btn.disabled = false;
    acToastError(e, 'No se pudo rechazar la solicitud.');
  });
}
function reqCancel(toId, btn) {
  if (btn) btn.disabled = true;
  acCancelFriendRequest(toId).then(function () {
    showToast('Solicitud cancelada.');
    acRefreshSidebar();
    reqLoad();
  }).catch(function (e) {
    if (btn) btn.disabled = false;
    acToastError(e, 'No se pudo cancelar la solicitud.');
  });
}

// Hook llamado por Realtime cuando llega una solicitud nueva.
window.reqOnNewRequest = function () { reqLoad(); };

acInitApp(function () {
  var ds = document.getElementById('discoverReqSearch');
  if (ds) ds.addEventListener('input', reqDiscover);
  reqLoad();
});
