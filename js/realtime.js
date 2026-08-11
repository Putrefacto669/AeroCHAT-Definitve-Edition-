// ═══════════════════════════════════════════════════════════════════
//  AeroChat · realtime.js
//  ------------------------------------------------------------------
//  Reemplaza al hub de SignalR usando Supabase Realtime:
//    · Presencia  → canal "aerochat-presence" (presence API)
//    · Escribiendo → canal "aerochat-typing" (broadcast)
//    · Datos      → canal "aerochat-tables" (postgres_changes)
//      (mensajes, reacciones, solicitudes, amistades, grupos,
//       estados, perfiles). RLS filtra qué filas recibe cada cliente.
//  ═══════════════════════════════════════════════════════════════════

function acInitRealtime() {
  acSubscribePresence();
  acSubscribeTyping();
  acSubscribeTables();
}

// ── Presencia ───────────────────────────────────────────────────────
function acSubscribePresence() {
  var uid = AC.authUser.id;
  var key = uid + '-' + acRandomId();   // clave única por pestaña
  var ch = AC.supabase.channel('aerochat-presence', { config: { presence: { key: key } } });

  ch.on('presence', { event: 'sync' }, function () {
    var st = ch.presenceState() || {};
    var map = {};
    Object.keys(st).forEach(function (k) {
      var v = st[k];
      var arr = Array.isArray(v) ? v : [v];
      arr.forEach(function (s) { if (s && s.user_id) map[s.user_id] = 1; });
    });
    AC.online = map;
    applyPresence();
  });
  ch.on('presence', { event: 'join' }, function (e) {
    (e.newPresences || []).forEach(function (p) { if (p && p.user_id) markOnline(p.user_id); });
  });
  ch.on('presence', { event: 'leave' }, function (e) {
    (e.leftPresences || []).forEach(function (p) { if (p && p.user_id) markOffline(p.user_id); });
  });
  ch.subscribe(function (status) {
    if (status === 'SUBSCRIBED') {
      ch.track({ user_id: uid, name: AC.me ? AC.me.display_name : '' });
    }
  });
  AC.channels.push(ch);
}

// ── Escribiendo… (broadcast) ────────────────────────────────────────
function acSubscribeTyping() {
  var ch = AC.supabase.channel('aerochat-typing');
  ch
    .on('broadcast', { event: 'typing' }, function (p) { acShowTyping(p || {}); })
    .on('broadcast', { event: 'stop_typing' }, function (p) { acClearTyping(p || {}); });
  ch.subscribe();
  AC.channels.push(ch);
  AC.typingCh = ch;
}
function acTypingSend(payload) { if (AC.typingCh) AC.typingCh.send({ type: 'broadcast', event: 'typing', payload: payload }); }
function acTypingStop(payload) { if (AC.typingCh) AC.typingCh.send({ type: 'broadcast', event: 'stop_typing', payload: payload }); }

function acShowTyping(p) {
  var rel = AC.view && (
    (AC.view.kind === 'direct' && p.to === AC.view.id) ||
    (AC.view.kind === 'group' && p.gid === AC.view.id)
  );
  if (!rel) return;
  var ind = document.getElementById('typingIndicator');
  if (!ind) return;
  var key = AC.view.id;
  if (AC.typingTimers && AC.typingTimers[key]) clearTimeout(AC.typingTimers[key]);
  ind.textContent = (p.name || 'Alguien') + ' está escribiendo…';
  AC.typingTimers = AC.typingTimers || {};
  AC.typingTimers[key] = setTimeout(function () {
    var el = document.getElementById('typingIndicator');
    if (el) el.textContent = '';
  }, 2500);
}
function acClearTyping(p) {
  var rel = AC.view && (
    (AC.view.kind === 'direct' && p.to === AC.view.id) ||
    (AC.view.kind === 'group' && p.gid === AC.view.id)
  );
  if (!rel) return;
  var ind = document.getElementById('typingIndicator');
  if (ind) ind.textContent = '';
  if (AC.typingTimers && AC.typingTimers[AC.view.id]) {
    clearTimeout(AC.typingTimers[AC.view.id]);
  }
}

// ── Cambios en tablas (postgres_changes) ────────────────────────────
function acSubscribeTables() {
  var ch = AC.supabase.channel('aerochat-tables');
  ch
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, acOnMessageChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, acOnReactionChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, acOnRequestChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, acOnFriendshipChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, acOnGroupChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'statuses' }, acOnStatusChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'status_likes' }, acOnStatusLikeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, acOnProfileChange)
    .subscribe();
  AC.channels.push(ch);
}

function acOnMessageChange(payload) {
  if (!AC.me) return;
  if (payload.eventType === 'DELETE') return;
  var m = payload.new || {};
  if (m.scope === 'direct') {
    if (m.sender_id !== AC.authUser.id && m.receiver_id !== AC.authUser.id) return;
    var other = m.sender_id === AC.authUser.id ? m.receiver_id : m.sender_id;
    if (AC.view && AC.view.kind === 'direct' && AC.view.id === other) {
      acHandleLiveMessage(m, payload.eventType);
      if (payload.eventType === 'INSERT' && m.sender_id !== AC.authUser.id) acMarkDirectRead(other);
    } else {
      acRefreshSidebar();
      if (payload.eventType === 'INSERT' && typeof acNotifyMessage === 'function') acNotifyMessage(m);
    }
  } else if (m.scope === 'group') {
    if (AC.view && AC.view.kind === 'group' && AC.view.id === m.receiver_id) {
      acHandleLiveMessage(m, payload.eventType);
      if (payload.eventType === 'INSERT' && m.sender_id !== AC.authUser.id) acMarkGroupRead(m.receiver_id);
    } else {
      acRefreshSidebar();
      if (payload.eventType === 'INSERT' && typeof acNotifyMessage === 'function') acNotifyMessage(m);
    }
  }
}

function acOnReactionChange(payload) {
  var row = payload.eventType === 'DELETE' ? (payload.old || {}) : (payload.new || {});
  if (!row.message_id) return;
  acHandleLiveReaction(row.message_id, row.user_id, row.emoji, payload.eventType === 'INSERT');
}

function acOnRequestChange(payload) {
  var n = payload.new || {};
  if (payload.eventType === 'INSERT') {
    if (n.to_user === AC.authUser.id && n.from_user !== AC.authUser.id) {
      acUserName(n.from_user).then(function (nm) {
        showToast((nm || 'Un usuario') + ' te envió una solicitud de amistad.', 'info');
      });
      acRefreshSidebar();
      if (window.reqOnNewRequest) window.reqOnNewRequest();
      var wrap = document.getElementById('profileFriendActions');
      if (wrap && wrap.getAttribute('data-userid') === n.from_user) {
        wrap.setAttribute('data-requestid', n.id || '');
        renderProfileFriendActions('incoming');
      }
    }
  } else {
    acRefreshSidebar();
  }
}

function acOnFriendshipChange(payload) {
  var n = payload.new || {};
  var o = payload.old || {};
  if (payload.eventType === 'INSERT') {
    if (n.user_id !== AC.authUser.id) return;
    acRefreshSidebar();
    if (AC.suppressFriendshipToast) return;
    var other = AC.usersById[n.friend_id];
    if (other) showToast(other.display_name + ' aceptó tu solicitud de amistad.', 'success');
    var wrap = document.getElementById('profileFriendActions');
    if (wrap && wrap.getAttribute('data-userid') === n.friend_id) renderProfileFriendActions('friends');
  } else if (payload.eventType === 'DELETE') {
    // PK compuesta → el evento DELETE trae user_id y friend_id.
    if (o.user_id !== AC.authUser.id) return;
    acRefreshSidebar();
    if (AC.suppressFriendshipToast) return;
    showToast('Te eliminaron de amigos.');
    var wrap2 = document.getElementById('profileFriendActions');
    if (wrap2 && wrap2.getAttribute('data-userid') === o.friend_id) renderProfileFriendActions('none');
  }
}

function acOnGroupChange(payload) {
  var n = payload.new || {};
  if (n.member_ids && n.member_ids.indexOf(AC.authUser.id) >= 0) {
    if (payload.eventType === 'INSERT') {
      acUserName(n.owner_id).then(function (nm) {
        showToast((nm || 'Alguien') + ' te agregó a un grupo.', 'info');
      });
    }
    acRefreshSidebar();
  }
  if (payload.eventType === 'DELETE') acRefreshSidebar();
  if (window.acOnGroupUpdate) window.acOnGroupUpdate(n, payload.eventType);
}

function acOnStatusChange(payload) {
  var n = payload.new || {};
  if (payload.eventType === 'INSERT') {
    showToast((n.user_name || 'Un amigo') + ' publicó un estado.', 'info');
    loadStatusStrip();
  } else {
    loadStatusStrip();
  }
  if (window.acOnStatusChangeHook) window.acOnStatusChangeHook(n, payload.eventType);
}

// Me gusta de estados: actualiza el contador en vivo del visor.
function acOnStatusLikeChange(payload) {
  var row = payload.new || payload.old || {};
  if (!row.status_id || row.user_id === AC.authUser.id) return;
  if (typeof statusGroups === 'undefined' || !statusGroups) return;
  for (var g = 0; g < statusGroups.length; g++) {
    for (var i = 0; i < statusGroups[g].items.length; i++) {
      var s = statusGroups[g].items[i];
      if (s.id !== row.status_id) continue;
      if (payload.eventType === 'INSERT') s.likes_count = (s.likes_count || 0) + 1;
      else if (payload.eventType === 'DELETE') s.likes_count = Math.max(0, (s.likes_count || 1) - 1);
      if (g === sgIdx && i === siIdx && typeof renderStatusLike === 'function') renderStatusLike();
      return;
    }
  }
}

function acOnProfileChange(payload) {
  var n = payload.new || {};
  if (n.id === AC.authUser.id) { AC.me = n; }
  acRefreshSidebar();
  if (window.acOnProfileChangeHook) window.acOnProfileChangeHook(n);
}

// ── Helper: nombre de usuario (cache → consulta) ────────────────────
function acUserName(id) {
  if (AC.usersById && AC.usersById[id]) return Promise.resolve(AC.usersById[id].display_name);
  return AC.supabase.from('profiles').select('display_name').eq('id', id).maybeSingle().then(function (r) {
    return (!r.error && r.data && r.data.display_name) ? r.data.display_name : '';
  });
}
