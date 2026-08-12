// ═══════════════════════════════════════════════════════════════════
//  AeroChat · group.js (conversación de grupo)
//  ------------------------------------------------------------------
//  Página group.html: carga el grupo, sus miembros y mensajes; render
//  del strip de miembros, administración (renombrar, avatar, agregar/
//  quitar miembros), llamada de grupo, typing y búsqueda.
//  ═══════════════════════════════════════════════════════════════════

var groupState = { id: null, group: null, members: [] };

function groupParams() {
  var m = /[?&]id=([^&]+)/.exec(location.search);
  return m ? decodeURIComponent(m[1]) : null;
}

function groupColor() { return acGroupColor(groupState.group); }

function renderGroupHeader() {
  var g = groupState.group;
  if (!g) return;
  var av = document.getElementById('groupAvatar');
  if (av) {
    av.style.background = groupColor();
    if (g.avatar_path) av.innerHTML = '<img src="' + escapeHtml(g.avatar_path) + '" class="group-avatar-img" alt=""/>';
    else av.textContent = (g.name || '?').charAt(0).toUpperCase();
  }
  document.getElementById('groupName').textContent = g.name;
  document.getElementById('memberCount').textContent = (groupState.members.length) + ' ' + (groupState.members.length === 1 ? 'miembro' : 'miembros');
  document.title = 'Grupo — ' + g.name + ' — AeroChat';
  var isOwner = g.owner_id === AC.authUser.id;
  document.getElementById('manageBtn').hidden = !isOwner;
  document.getElementById('groupRename').value = g.name;
}

function renderMembersStrip() {
  var strip = document.getElementById('membersStrip');
  if (!strip) return;
  strip.innerHTML = groupState.members.map(function (m) {
    return '<a href="profile.html?u=' + m.id + '" class="member-chip" title="' + escapeHtml(m.display_name) + '">' +
      '<span class="avatar-wrap">' +
      (m.avatar_path
        ? '<img src="' + escapeHtml(m.avatar_path) + '" class="avatar avatar-sm" alt=""/>'
        : '<span class="avatar avatar-sm" style="background:' + escapeHtml(m.avatar_color) + '">' + escapeHtml((m.display_name || '?').charAt(0)) + '</span>') +
      '<span class="presence-dot" data-userid="' + m.id + '"></span>' +
      '</span>' +
      '<span class="member-chip-name">' + escapeHtml(m.display_name) + '</span></a>';
  }).join('');
  renderOnlineCount();
}

function renderOnlineCount() {
  var el = document.getElementById('onlineCount');
  if (!el) return;
  var online = 0;
  document.querySelectorAll('#membersStrip .presence-dot').forEach(function (dot) {
    if (dot.classList.contains('online')) online++;
  });
  el.textContent = online;
}
document.addEventListener('ac:presence', renderOnlineCount);

function renderMemberAdminList() {
  var box = document.getElementById('groupMemberAdminList');
  if (!box) return;
  var g = groupState.group;
  var isOwner = g && g.owner_id === AC.authUser.id;
  box.innerHTML = groupState.members.map(function (m) {
    var isOwnerRow = g.owner_id === m.id;
    var canRemove = isOwner && !isOwnerRow && m.id !== AC.authUser.id;
    return '<div class="group-member-admin">' +
      '<span class="group-member-admin-name">' + escapeHtml(m.display_name) + (isOwnerRow ? ' (dueño)' : '') + '</span>' +
      (canRemove ? '<button type="button" class="mini-btn mini-decline" title="Quitar del grupo" onclick="removeGroupMember(\'' + m.id + '\')">' + acIcon('close', 13) + '</button>' : '') +
      '</div>';
  }).join('') || '<div class="sidebar-empty">Sin miembros</div>';
}

function loadAddMembers() {
  var box = document.getElementById('groupAddMembers');
  if (!box) return;
  box.innerHTML = 'Cargando amigos…';
  var memberSet = {};
  (groupState.members || []).forEach(function (m) { memberSet[m.id] = 1; });
  acGetFriends().then(function (friends) {
    var candidates = (friends || []).filter(function (f) { return !memberSet[f.id]; });
    if (!candidates.length) {
      box.innerHTML = '<div class="sidebar-empty">No hay amigos para agregar.</div>';
      return;
    }
    box.innerHTML = candidates.map(function (f) {
      return '<label class="group-pick-item">' +
        '<input type="checkbox" value="' + f.id + '"/>' +
        '<span class="avatar-wrap">' + acAvatarHtml(f, 'avatar avatar-sm') + '</span>' +
        '<span class="group-pick-name">' + escapeHtml(f.display_name) + '</span>' +
        '</label>';
    }).join('');
  }).catch(function () {
    box.innerHTML = '<div class="sidebar-empty">No se pudieron cargar tus amigos.</div>';
  });
}

function loadGroup() {
  return acGetGroup(groupState.id).then(function (g) {
    if (!g) { showToast('No se encontró el grupo.', 'error'); setTimeout(function () { location.href = 'chat.html'; }, 1200); return null; }
    groupState.group = g;
    return acGetMembers(g.member_ids || []).then(function (members) {
      groupState.members = members || [];
      renderGroupHeader();
      renderMembersStrip();
      renderMemberAdminList();
      return g;
    });
  });
}

function loadGroupMessages() {
  return acGetGroupMessages(groupState.id).then(function (msgs) {
    var area = document.getElementById('messages');
    if (area) area.innerHTML = '';
    (msgs || []).forEach(function (m) { addMessageToArea(m); });
    if (!(msgs || []).length) {
      var el = document.createElement('div');
      el.className = 'no-messages';
      el.textContent = 'Todavía no hay mensajes — ¡dale inicio al grupo!';
      document.getElementById('messages').appendChild(el);
    }
    scrollToBottom();
    acMarkGroupRead(groupState.id);
  });
}

function groupRefreshMembers() {
  acGetGroup(groupState.id).then(function (g) {
    if (!g) { location.href = 'chat.html'; return; }
    groupState.group = g;
    return acGetMembers(g.member_ids || []).then(function (members) {
      groupState.members = members || [];
      renderGroupHeader();
      renderMembersStrip();
      renderMemberAdminList();
    });
  });
}

// ── Administración ──────────────────────────────────────────────────
function renameGroup() {
  var name = (document.getElementById('groupRename').value || '').trim();
  if (!name) { showToast('Escribí un nombre.'); return; }
  acRenameGroup(groupState.id, name).then(function (ok) {
    if (!ok) { showToast('No se pudo renombrar.'); return; }
    groupState.group.name = name;
    renderGroupHeader();
    acRefreshSidebar();
    showToast('Grupo renombrado.', 'success');
  });
}

function groupAvatarChanged(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  input.disabled = true;
  var path = AC.authUser.id + '/group-' + acRandomId() + '.' + acExt(file.name);
  acUpload('groups', path, file).then(function (url) {
    return acSetGroupAvatar(groupState.id, url);
  }).then(function () {
    groupState.group.avatar_path = acPublicUrl('groups', path);
    renderGroupHeader();
    acRefreshSidebar();
    showToast('Avatar actualizado.', 'success');
    loadAddMembers();
  }).catch(function (e) {
    acToastError(e, 'No se pudo subir el avatar');
  }).then(function () {
    input.disabled = false;
    input.value = '';
  });
}

function addGroupMembers() {
  var ids = Array.prototype.slice.call(document.querySelectorAll('#groupAddMembers input:checked')).map(function (c) { return c.value; });
  if (!ids.length) { showToast('Elegí al menos un amigo.'); return; }
  var pending = ids.slice();
  var next = function () {
    if (!pending.length) {
      groupRefreshMembers();
      acRefreshSidebar();
      loadAddMembers();
      showToast('Miembros agregados.', 'success');
      return;
    }
    var id = pending.shift();
    acAddGroupMember(groupState.id, id).then(function () { next(); });
  };
  next();
}

function removeGroupMember(memberId) {
  if (!confirm('¿Quitar a este miembro del grupo?')) return;
  acRemoveGroupMember(groupState.id, memberId).then(function () {
    groupRefreshMembers();
    acRefreshSidebar();
    showToast('Miembro quitado.');
  });
}

function leaveGroup() {
  if (!confirm('¿Salir del grupo? Dejarás de ver sus mensajes.')) return;
  acRemoveGroupMember(groupState.id, AC.authUser.id).then(function () {
    location.href = 'chat.html';
  }).catch(function () { showToast('No se pudo salir del grupo.', 'error'); });
}

// ── Inicialización ──────────────────────────────────────────────────
function groupInit() {
  groupState.id = groupParams();
  if (!groupState.id) { location.replace('chat.html'); return; }

  AC.view = { kind: 'group', id: groupState.id, me: AC.me };

  loadGroup().then(function (g) {
    if (!g) return null;
    return loadGroupMessages();
  }).then(function () {
    scrollToBottom();
  }).catch(function (e) { acToastError(e, 'No se pudo cargar el grupo'); });

  // Cambios en vivo del grupo
  window.acOnGroupUpdate = function (n, eventType) {
    if (n && n.id === groupState.id) {
      if (eventType === 'UPDATE' && (n.member_ids || []).indexOf(AC.authUser.id) < 0) {
        location.href = 'chat.html';
        return;
      }
      groupRefreshMembers();
    }
  };

  // Enviar
  document.getElementById('sendBtn').addEventListener('click', acSendText);
  var input = document.getElementById('msgInput');
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); acSendText(); }
  });
  acInitComposer();

  // Escribiendo…
  var typingTimer = null;
  input.addEventListener('input', function () {
    if (typingTimer) clearTimeout(typingTimer);
    acTypingSend({ gid: groupState.id, from: AC.authUser.id, name: AC.me ? AC.me.display_name : '' });
    typingTimer = setTimeout(function () { acTypingStop({ gid: groupState.id, from: AC.authUser.id }); }, 1200);
  });

  // Búsqueda
  acBindSearch(function (q) { return acSearchGroup(groupState.id, q); });

  // Llamadas
  document.getElementById('callAudioBtn').addEventListener('click', function () {
    callGroup(groupState.id, groupState.group.name, groupColor(), 'audio');
  });
  document.getElementById('callVideoBtn').addEventListener('click', function () {
    callGroup(groupState.id, groupState.group.name, groupColor(), 'video');
  });

  acMarkGroupRead(groupState.id);
}

acInitApp(function () {
  acInitCalls();
  groupInit();
});
