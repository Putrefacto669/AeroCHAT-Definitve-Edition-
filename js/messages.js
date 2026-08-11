// ═══════════════════════════════════════════════════════════════════
//  AeroChat · messages.js
//  ------------------------------------------------------------------
//  Render compartido de burbujas de mensaje (DM y grupos), acciones
//  (responder, editar, borrar, reaccionar), búsqueda, lightbox y
//  recepción en vivo vía Realtime (acHandleLiveMessage/Reaction).
//  Usa el estado global AC.view (configurado por cada página).
//  ═══════════════════════════════════════════════════════════════════

function htmlEncode(s) { return escapeHtml(s); }

function formatTime(d) {
  var dt = new Date(d);
  return String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
}
function localDateKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function normalizeType(t) {
  if (typeof t === 'number') return t;
  switch (String(t).toLowerCase()) {
    case 'text': return 0;
    case 'image': return 1;
    case 'audio': return 2;
    case 'video': return 4;
    case 'sticker': return 5;
    default: return 3;
  }
}
function typeName(t) {
  var n = normalizeType(t);
  return n === 0 ? 'texto' : n === 1 ? 'imagen' : n === 2 ? 'audio' : n === 4 ? 'video' : n === 5 ? 'sticker' : 'archivo';
}
function scrollToBottom() {
  var msgs = document.getElementById('messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function acMsgRow(id) { return document.querySelector('.msg-row[data-id="' + id + '"]'); }
function acIsMine(msg) { return msg.sender_id === AC.me.id; }
function acMsgSeen(msg) {
  var readBy = msg.read_by || [];
  if (AC.view.kind === 'direct') {
    return AC.view.partner && readBy.indexOf(AC.view.partner.id) >= 0;
  }
  return readBy.length > 0;
}

// ── Burbuja de mensaje ──────────────────────────────────────────────
function buildMessageRow(msg) {
  var isMine = acIsMine(msg);
  var side = isMine ? 'mine' : 'theirs';

  // avatar del otro (solo DM)
  var avatarHtml = '';
  if (!isMine && AC.view.kind === 'direct') {
    var p = AC.view.partner || {};
    if (p.avatar_path) {
      avatarHtml = '<a href="profile.html?u=' + msg.sender_id + '"><img src="' + escapeHtml(p.avatar_path) + '" class="avatar avatar-sm" alt=""/></a>';
    } else {
      avatarHtml = '<a href="profile.html?u=' + msg.sender_id + '"><span class="avatar avatar-sm" style="background:' + escapeHtml(msg.sender_color || '#6C63FF') + '">' + escapeHtml((msg.sender_name || '?').charAt(0)) + '</span></a>';
    }
  }

  // nombre del remitente (solo grupos)
  var senderHtml = '';
  if (!isMine && AC.view.kind === 'group') {
    senderHtml = '<span class="msg-sender" style="color:' + escapeHtml(msg.sender_color || '#6C63FF') + '">' + htmlEncode(msg.sender_name) + '</span>';
  }

  var replyHtml = '';
  if (msg.reply_to_id) {
    var qt = acQuoteInfo(msg.reply_to_id, msg.reply_to_content);
    replyHtml = '<div class="msg-reply" onclick="scrollToMessage(\'' + msg.reply_to_id + '\')">' +
      '<span class="msg-reply-sender">' + htmlEncode(msg.reply_to_sender || '') + '</span>' +
      '<span class="msg-reply-content">' + qt.icon + htmlEncode(qt.content) + '</span></div>';
  }

  var type = normalizeType(msg.type);
  var innerHtml = '';
  switch (type) {
    case 0: innerHtml = '<span class="msg-text">' + htmlEncode(msg.content) + '</span>'; break;
    case 1: innerHtml = '<img src="' + escapeHtml(msg.file_path) + '" alt="' + htmlEncode(msg.file_name) + '" class="msg-image" onclick="openLightbox(this)"/>'; break;
    case 5: innerHtml = '<img src="' + escapeHtml(msg.file_path) + '" class="msg-sticker" alt="sticker"/>'; break;
    case 2: innerHtml = '<div class="msg-audio"><span class="file-icon">' + acIcon('music', 16) + '</span><div><div class="file-name">' + htmlEncode(msg.file_name) + '</div><audio controls src="' + escapeHtml(msg.file_path) + '"></audio></div></div>'; break;
    case 4: innerHtml = '<div class="msg-video"><video controls preload="metadata" src="' + escapeHtml(msg.file_path) + '"></video><div class="file-name">' + htmlEncode(msg.file_name) + '</div></div>'; break;
    default: innerHtml = '<div class="msg-doc"><span class="file-icon">' + acIcon('file', 16) + '</span><div><div class="file-name">' + htmlEncode(msg.file_name) + '</div><a href="' + escapeHtml(msg.file_path) + '" download="' + htmlEncode(msg.file_name) + '" class="file-download">Descargar</a></div></div>'; break;
  }

  var metaHtml = '<div class="msg-meta">';
  if (msg.edited_at) metaHtml += '<span class="msg-edited">editado</span>';
  metaHtml += '<span class="msg-time">' + formatTime(msg.created_at) + '</span>';
  if (isMine && !msg.is_deleted) {
    metaHtml += '<span class="msg-seen">' + (acMsgSeen(msg) ? acIcon('check-all', 11) : acIcon('check', 11)) + '</span>';
  }
  metaHtml += '</div>';

  var reactionsHtml = '';
  if (!msg.is_deleted) {
    var grouped = {};
    var mineSet = {};
    if (msg.reactions && msg.reactions.length) {
      msg.reactions.forEach(function (r) {
        grouped[r.emoji] = (grouped[r.emoji] || 0) + 1;
        if (r.user_id === AC.me.id) mineSet[r.emoji] = 1;
      });
    }
    reactionsHtml = '<div class="msg-reactions">';
    Object.keys(grouped).forEach(function (e) {
      var eAttr = escapeHtml(e);
      reactionsHtml += '<button class="reaction-chip' + (mineSet[e] ? ' mine' : '') + '" data-emoji="' + eAttr + '" onclick="toggleReaction(\'' + msg.id + '\',\'' + jsEncode(e) + '\')"><span class="rc-emoji">' + eAttr + '</span><span class="rc-count">' + grouped[e] + '</span></button>';
    });
    reactionsHtml += '<button class="reaction-add" title="Reaccionar" onclick="openReactionPicker(\'' + msg.id + '\', event)">' + acIcon('plus', 11) + '</button></div>';
  }

  var actionsHtml = '';
  if (!msg.is_deleted) {
    var preview = type === 0 ? String(msg.content || '').slice(0, 40) : '[' + typeName(type) + ']';
    actionsHtml = '<div class="msg-actions">' +
      '<button class="action-btn action-reply" title="Responder" onclick="respondTo(\'' + msg.id + '\',\'' + jsEncode(msg.sender_name || '') + '\',\'' + jsEncode(preview) + '\')">' + acIcon('reply', 13) + '</button>';
    if (isMine) {
      var editBtn = type === 0 ? '<button class="action-btn" onclick="openEdit(\'' + msg.id + '\',\'' + jsEncode(msg.content) + '\')">' + acIcon('edit', 13) + '</button>' : '';
      actionsHtml += editBtn + '<button class="action-btn del" onclick="confirmDelete(\'' + msg.id + '\')">' + acIcon('trash', 13) + '</button>';
    }
    actionsHtml += '</div>';
  }

  var bubble = document.createElement('div');
  bubble.className = 'bubble ' + side + (type === 5 ? ' sticker' : '') + (msg.is_deleted ? ' deleted' : '');
  bubble.innerHTML = senderHtml + replyHtml + innerHtml + metaHtml + reactionsHtml + actionsHtml;

  var row = document.createElement('div');
  row.className = 'msg-row ' + side;
  row.setAttribute('data-id', msg.id);
  row.innerHTML = avatarHtml;
  row.appendChild(bubble);
  return row;
}

function addMessageToArea(msg) {
  var area = document.getElementById('messages');
  if (!area) return;
  if (acMsgRow(msg.id)) return;   // ya está (optimismo / duplicado realtime)

  var noMsg = area.querySelector('.no-messages');
  if (noMsg) noMsg.remove();

  var created = new Date(msg.created_at);
  var dateKey = localDateKey(created);
  var lastDivider = area.querySelector('.date-divider:last-child');
  if (!lastDivider || lastDivider.getAttribute('data-date') !== dateKey) {
    var d = document.createElement('div');
    d.className = 'date-divider';
    d.setAttribute('data-date', dateKey);
    d.textContent = created.toLocaleDateString('es-GT', { day: 'numeric', month: 'long' });
    area.appendChild(d);
  }
  area.appendChild(buildMessageRow(msg));
}

function applyDeletedState(row) {
  var actions = row.querySelector('.msg-actions'); if (actions) actions.remove();
  var reactions = row.querySelector('.msg-reactions'); if (reactions) reactions.remove();
  var bubble = row.querySelector('.bubble');
  if (bubble) {
    bubble.classList.add('deleted');
    bubble.innerHTML = '<span class="msg-text">Mensaje eliminado</span><div class="msg-meta"></div>';
  }
}
function updateSeen(row, msg) {
  var seen = row.querySelector('.msg-seen');
  if (seen) seen.innerHTML = acMsgSeen(msg) ? acIcon('check-all', 11) : acIcon('check', 11);
}

// ── Eventos en vivo (los invoca realtime.js) ────────────────────────
function acHandleLiveMessage(m, eventType) {
  if (eventType === 'INSERT') {
    if (acMsgRow(m.id)) return;
    addMessageToArea(m);
    if (m.sender_id !== AC.me.id) scrollToBottom();
    return;
  }
  var row = acMsgRow(m.id);
  if (!row) return;
  if (m.is_deleted) { applyDeletedState(row); return; }
  if (m.edited_at) {
    var t = row.querySelector('.msg-text');
    if (t) t.textContent = m.content;
    var meta = row.querySelector('.msg-meta');
    if (meta && !meta.querySelector('.msg-edited')) {
      var span = document.createElement('span');
      span.className = 'msg-edited';
      span.textContent = 'editado';
      meta.insertBefore(span, meta.firstChild);
    }
  }
  if (m.sender_id === AC.me.id) updateSeen(row, m);
}

function acHandleLiveReaction(messageId, userId, emoji, added) {
  if (userId === AC.me.id) return;   // el propio RPC ya actualizó la UI
  var row = acMsgRow(messageId);
  if (!row) return;
  var chip = acReactionChip(row, emoji);
  var current = chip ? parseInt(chip.querySelector('.rc-count').textContent, 10) : 0;
  var count = added ? current + 1 : current - 1;
  applyReaction(messageId, emoji, userId, added, Math.max(count, 0));
}

// ── Reacciones ──────────────────────────────────────────────────────
function acReactionChip(row, emoji) {
  var chips = row.querySelectorAll('.reaction-chip');
  for (var i = 0; i < chips.length; i++) {
    if (chips[i].getAttribute('data-emoji') === emoji) return chips[i];
  }
  return null;
}

function applyReaction(messageId, emoji, userId, added, count) {
  var row = acMsgRow(messageId);
  if (!row) return;
  var chip = acReactionChip(row, emoji);
  var mine = userId === AC.me.id;
  if (added) {
    if (chip) {
      chip.querySelector('.rc-count').textContent = count;
      chip.classList.toggle('mine', mine);
    } else {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'reaction-chip' + (mine ? ' mine' : '');
      btn.setAttribute('data-emoji', emoji);
      btn.innerHTML = '<span class="rc-emoji">' + escapeHtml(emoji) + '</span><span class="rc-count">' + count + '</span>';
      btn.onclick = function () { toggleReaction(messageId, emoji); };
      var wrap = row.querySelector('.msg-reactions');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'msg-reactions';
        var b = row.querySelector('.bubble');
        if (b) b.appendChild(wrap);
      }
      var addBtn = wrap.querySelector('.reaction-add');
      if (addBtn) wrap.insertBefore(btn, addBtn); else wrap.appendChild(btn);
    }
  } else if (chip) {
    if (count > 0) {
      chip.querySelector('.rc-count').textContent = count;
      chip.classList.toggle('mine', mine);
    } else {
      chip.remove();
    }
  }
}

function toggleReaction(messageId, emoji) {
  acToggleReaction(messageId, emoji).then(function (r) {
    if (!r) return;
    applyReaction(messageId, r.emoji, AC.me.id, r.added, r.count);
  }).catch(function (e) { acToastError(e, 'No se pudo reaccionar'); });
}

function openReactionPicker(messageId, ev) {
  if (ev) ev.stopPropagation();
  var row = acMsgRow(messageId);
  if (!row) return;
  var existing = row.querySelector('.reaction-picker');
  if (existing) { existing.remove(); return; }
  var bar = document.createElement('div');
  bar.className = 'reaction-picker';
  ['👍', '❤️', '😂', '😮', '🙏'].forEach(function (e) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = e;
    b.className = 'reaction-pick';
    b.onclick = function () { bar.remove(); toggleReaction(messageId, e); };
    bar.appendChild(b);
  });
  var bubble = row.querySelector('.bubble');
  if (bubble) bubble.appendChild(bar);
}

// ── Responder (citar) ───────────────────────────────────────────────
function acQuoteInfo(id, fallbackContent) {
  var icon = '', label = '';
  var row = acMsgRow(id);
  var t = 0;
  if (row) {
    if (row.querySelector('.msg-sticker')) t = 5;
    else if (row.querySelector('.msg-image')) t = 1;
    else if (row.querySelector('.msg-audio')) t = 2;
    else if (row.querySelector('.msg-video')) t = 4;
    else if (row.querySelector('.msg-doc')) t = 3;
  }
  if (t) {
    icon = acIcon(t === 5 ? 'star-fill' : t === 1 ? 'image' : t === 2 ? 'music' : t === 4 ? 'film' : 'file', 13);
    label = '[' + typeName(t) + ']';
  }
  var content = (fallbackContent && String(fallbackContent).trim()) ? fallbackContent : label;
  return { icon: icon, content: content };
}

function respondTo(id, name, content) {
  AC.replyTo = { id: id, name: name, content: content };
  var bar = document.getElementById('replyBar');
  if (!bar) return;
  var q = acQuoteInfo(id, content);
  bar.innerHTML =
    '<span class="reply-bar-main" onclick="scrollToReply()">' +
      '<span class="reply-bar-label">' + acIcon('reply', 13) + ' Respondiendo a ' + htmlEncode(name) + '</span>' +
      '<span class="reply-bar-content">' + q.icon + ' ' + htmlEncode(q.content) + '</span>' +
    '</span>' +
    '<button type="button" class="reply-bar-close" title="Cancelar" onclick="event.stopPropagation(); cancelReply()">' + acIcon('close', 13) + '</button>';
  bar.classList.add('active');
  var inp = document.getElementById('msgInput');
  if (inp) inp.focus();
}
function cancelReply() {
  AC.replyTo = null;
  var bar = document.getElementById('replyBar');
  if (bar) { bar.classList.remove('active'); bar.innerHTML = ''; }
}
function scrollToMessage(id) {
  var row = acMsgRow(id);
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
}
function scrollToReply() {
  if (AC.replyTo) scrollToMessage(AC.replyTo.id);
}
function acBindMsgTapActions() {
  if (!window.matchMedia || !matchMedia('(hover: none)').matches) return;
  document.addEventListener('click', function (e) {
    var row = e.target && e.target.closest ? e.target.closest('.msg-row') : null;
    var open = document.querySelectorAll('.msg-row.show-actions');
    for (var i = 0; i < open.length; i++) {
      if (open[i] !== row) open[i].classList.remove('show-actions');
    }
    if (!row) return;
    if (e.target.closest('a, button, audio, video, img, .msg-actions')) return;
    if (row.classList.contains('show-actions')) row.classList.remove('show-actions');
    else row.classList.add('show-actions');
  });
}

// ── Editar / borrar ─────────────────────────────────────────────────
function openEdit(id, content) {
  document.getElementById('editMsgId').value = id;
  document.getElementById('editContent').value = content;
  openModal('editModal');
}
function confirmDelete(msgId) {
  document.getElementById('deleteMsgId').value = msgId;
  openModal('deleteModal');
}
function submitEdit() {
  var mid = document.getElementById('editMsgId').value;
  var content = document.getElementById('editContent').value.trim();
  if (!content) return;
  closeModal('editModal');
  acEditMessage(mid, content).then(function (m) {
    if (m) acHandleLiveMessage(m, 'UPDATE');
  }).catch(function (e) { acToastError(e, 'No se pudo editar'); });
}
function submitDelete() {
  var mid = document.getElementById('deleteMsgId').value;
  closeModal('deleteModal');
  acDeleteMessage(mid).then(function (m) {
    if (m) acHandleLiveMessage(m, 'UPDATE');
  }).catch(function (e) { acToastError(e, 'No se pudo eliminar'); });
}

// ── Lightbox ────────────────────────────────────────────────────────
function openLightbox(img) {
  document.getElementById('lightboxImg').src = img.src;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() {
  var lb = document.getElementById('lightbox');
  if (lb) lb.classList.remove('open');
}

// ── Enviar mensajes (texto / sticker / archivo) ────────────────────
function acSendMessageContent(type, content, filePath, fileName, size, replyToId) {
  var kind = AC.view.kind;
  var p = kind === 'direct'
    ? acInsertDirectMessage(AC.view.id, content, type, fileName, filePath, size, replyToId)
    : acInsertGroupMessage(AC.view.id, content, type, fileName, filePath, size, replyToId);
  return p.then(function (m) {
    if (m) { addMessageToArea(m); scrollToBottom(); }
    return m;
  }).catch(function (e) {
    acToastError(e, 'No se pudo enviar el mensaje');
    return null;
  });
}

function acSendText() {
  var input = document.getElementById('msgInput');
  if (!input) return;
  var content = input.value.trim();
  if (!content) return;
  input.value = '';
  var rid = AC.replyTo ? AC.replyTo.id : null;
  cancelReply();
  acUpdateComposer();
  acSendMessageContent('text', content, null, null, null, rid);
}

function toggleAttach() {
  var panel = document.getElementById('attachPanel');
  if (panel) panel.classList.toggle('open');
}

function acPickAttach(type, input) {
  var file = input && input.files && input.files[0];
  if (file) acSendAttach(type, file);
  if (input) input.value = '';
}

function acSendSticker(path) {
  acRpc('record_sticker_use', { p_path: path }).catch(function () {});
  acSendMessageContent('sticker', '', path, 'sticker.png', null, AC.replyTo ? AC.replyTo.id : null);
}

function acSendAttach(type, file) {
  var path = AC.me.id + '/' + acRandomId() + '.' + acExt(file.name);
  acUpload('messages', path, file)
    .then(function (url) { return acSendMessageContent(type, '', url, file.name, file.size, null); })
    .catch(function (e) { acToastError(e, 'No se pudo subir el archivo'); });
}

// ── Notas de voz (grabación por micrófono) ─────────────────────────
var acRec = { mr: null, chunks: [], stream: null, timer: null, secs: 0, running: false, wantSend: false };

function acStartRecording() {
  if (acRec.running) return;
  if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Tu navegador no permite grabar audio', 'error');
    return;
  }
  var ap = document.getElementById('attachPanel');
  if (ap) ap.classList.remove('open');
  var sp = document.getElementById('stickerPanel');
  if (sp) { sp.hidden = true; sp.classList.remove('open'); }

  navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    acRec.stream = stream;
    acRec.chunks = [];
    var opts = {};
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      opts.mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/mp4')) {
      opts.mimeType = 'audio/mp4';
    }
    acRec.mr = new MediaRecorder(stream, opts);
    acRec.mr.ondataavailable = function (e) { if (e.data && e.data.size) acRec.chunks.push(e.data); };
    acRec.mr.onstop = acRecordingFinished;
    acRec.mr.start();
    acRec.secs = 0;
    acRec.running = true;
    acRec.wantSend = false;
    acSetRecordingUI(true);
    acRec.timer = setInterval(function () {
      acRec.secs++;
      if (acRec.secs >= 60) acStopRecording(true);
      var t = document.getElementById('recTimer');
      if (t) t.textContent = Math.floor(acRec.secs / 60) + ':' + String(acRec.secs % 60).padStart(2, '0');
    }, 1000);
  }).catch(function (e) {
    acToastError(e, 'No se pudo acceder al micrófono');
  });
}

function acStopRecording(send) {
  if (!acRec.running) return;
  acRec.wantSend = !!send;
  if (acRec.mr && acRec.mr.state !== 'inactive') {
    try { acRec.mr.stop(); return; } catch (e) {}
  }
  acRecordingFinished();
}

function acRecordingFinished() {
  clearInterval(acRec.timer);
  acRec.timer = null;
  acRec.running = false;
  acSetRecordingUI(false);
  if (acRec.stream) { acRec.stream.getTracks().forEach(function (t) { t.stop(); }); acRec.stream = null; }
  var send = acRec.wantSend;
  var chunks = acRec.chunks;
  acRec.chunks = [];
  if (!send || !chunks.length) return;
  var blob = new Blob(chunks, { type: 'audio/webm' });
  var ext = 'webm';
  if (acRec.mr && acRec.mr.mimeType && acRec.mr.mimeType.indexOf('mp4') !== -1) ext = 'm4a';
  acRec.mr = null;
  var path = AC.me.id + '/' + acRandomId() + '.' + ext;
  var fileName = 'Nota de voz.' + ext;
  var file = new File([blob], fileName, { type: 'audio/' + ext });
  acUpload('messages', path, file)
    .then(function (url) {
      return acSendMessageContent('audio', '', url, fileName, file.size, AC.replyTo ? AC.replyTo.id : null);
    })
    .catch(function (e) { acToastError(e, 'No se pudo subir la nota de voz'); });
}

function acSetRecordingUI(on) {
  var form = document.getElementById('sendForm');
  var bar = document.getElementById('recBar');
  var input = document.getElementById('msgInput');
  var mic = document.getElementById('micBtn');
  var send = document.getElementById('sendBtn');
  if (form) form.classList.toggle('recording', on);
  if (bar) bar.hidden = !on;
  if (input) input.hidden = on;
  if (mic) mic.hidden = on;
  if (send) send.hidden = on;
  if (form) {
    var attach = form.querySelector('.icon-btn-attach');
    var sticker = form.querySelector('.icon-btn-sticker');
    var gif = form.querySelector('.icon-btn-gif');
    if (attach) attach.hidden = on;
    if (sticker) sticker.hidden = on;
    if (gif) gif.hidden = on;
  }
  if (!on) acUpdateComposer();
}

function acUpdateComposer() {
  var input = document.getElementById('msgInput');
  if (!input) return;
  var has = input.value.trim().length > 0;
  var mic = document.getElementById('micBtn');
  var send = document.getElementById('sendBtn');
  if (mic) mic.hidden = has || acRec.running;
  if (send) send.hidden = acRec.running;
}

function acInitComposer() {
  var input = document.getElementById('msgInput');
  if (!input || input.dataset.acBound) return;
  input.dataset.acBound = '1';
  input.addEventListener('input', acUpdateComposer);
  acUpdateComposer();
  acBindMsgTapActions();
}

// ── Búsqueda ────────────────────────────────────────────────────────
var acSearchTimer = null;
function toggleSearch() {
  var panel = document.getElementById('searchPanel');
  if (!panel) return;
  var open = panel.hidden;
  panel.hidden = !open;
  if (open) {
    document.getElementById('searchInput').value = '';
    renderSearchResults([]);
    document.getElementById('searchInput').focus();
  }
}
function closeSearch() {
  var panel = document.getElementById('searchPanel');
  if (panel) panel.hidden = true;
  var inp = document.getElementById('searchInput');
  if (inp) inp.value = '';
}
function highlightText(text, q) {
  var needle = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp('(' + needle + ')', 'ig');
  return String(text).replace(re, '<mark class="search-hit">$1</mark>');
}
function renderSearchResults(results) {
  var box = document.getElementById('searchResults');
  if (!box) return;
  var inp = document.getElementById('searchInput');
  var q = inp ? inp.value.trim() : '';
  var count = document.getElementById('searchCount');
  if (count) {
    count.hidden = results.length === 0;
    count.textContent = results.length + (results.length === 1 ? ' resultado' : ' resultados');
  }
  if (!results.length) {
    box.innerHTML = q
      ? '<div class="search-empty">Sin resultados para «' + htmlEncode(q) + '»</div>'
      : '<div class="search-empty">Escribí para buscar…</div>';
    return;
  }
  box.innerHTML = results.map(function (m) {
    var content = htmlEncode(m.content || '');
    if (q) content = highlightText(content, q);
    return '<div class="search-result" onclick="goToMessage(\'' + m.id + '\')">' +
      '<span class="search-result-avatar" style="background:' + htmlEncode(m.sender_color || '#6C63FF') + '">' + htmlEncode((m.sender_name || '?').charAt(0).toUpperCase()) + '</span>' +
      '<span class="search-result-body">' +
      '<span class="search-result-name">' + htmlEncode(m.sender_name || '') + '</span>' +
      '<span class="search-result-text">' + content + '</span>' +
      '</span>' +
      '<span class="search-result-time">' + formatTime(m.created_at) + '</span></div>';
  }).join('');
}
function goToMessage(id) {
  closeSearch();
  var row = acMsgRow(id);
  if (!row) return;
  row.scrollIntoView({ block: 'center' });
  row.classList.add('flash');
  setTimeout(function () { row.classList.remove('flash'); }, 1600);
}
function acBindSearch(fetchFn) {
  document.addEventListener('DOMContentLoaded', function () {
    var inp = document.getElementById('searchInput');
    if (!inp) return;
    inp.addEventListener('input', function () {
      clearTimeout(acSearchTimer);
      var q = inp.value.trim();
      if (!q) { renderSearchResults([]); return; }
      acSearchTimer = setTimeout(function () {
        fetchFn(q).then(function (r) { renderSearchResults(r || []); });
      }, 300);
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSearch(); });
  });
}
