// ═══════════════════════════════════════════════════════════════════
//  AeroChat · status.js (visor de estados)
//  ------------------------------------------------------------------
//  Página status.html: reproduce los estados de amigos en modo
//  "historias" (barras de progreso, navegación, auto-avance), permite
//  responder/mencionar (abre DM) y eliminar el propio estado.
//  ═══════════════════════════════════════════════════════════════════

var statusGroups = [];
var statusFriends = [];
var sgIdx = 0, siIdx = 0, sTimer = null;
var composeMode = 'reply';
var composeTarget = null;

function timeAgo(iso) {
  var diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'hace un momento';
  var m = Math.floor(diff / 60);
  if (m < 60) return 'hace ' + m + ' min';
  var h = Math.floor(m / 60);
  if (h < 24) return 'hace ' + h + ' h';
  return new Date(iso).toLocaleDateString('es-GT', { day: 'numeric', month: 'short' });
}

function curStatus() {
  return statusGroups[sgIdx] ? statusGroups[sgIdx].items[siIdx] : null;
}

function renderStatus() {
  if (sTimer) clearTimeout(sTimer);
  var g = statusGroups[sgIdx];
  var body = document.getElementById('statusBody');
  if (!g) { body.textContent = 'No hay estados todavía.'; return; }
  var s = g.items[siIdx];

  var prog = document.getElementById('statusProgress');
  prog.innerHTML = '';
  g.items.forEach(function (_, i) {
    var bar = document.createElement('div');
    bar.className = 'status-progress-bar';
    if (i < siIdx) bar.classList.add('done');
    prog.appendChild(bar);
  });
  var activeBar = prog.children[siIdx];
  if (activeBar) {
    activeBar.classList.add('active');
    activeBar.classList.add(s.type === 'image' ? 'slow' : 'fast');
    activeBar.addEventListener('animationend', nextStatus);
  }

  var av = document.getElementById('statusAvatar');
  av.style.background = s.user_color || '#6C63FF';
  av.textContent = (s.user_name || '?').charAt(0).toUpperCase();
  if (s.user_avatar) av.innerHTML = '<img src="' + escapeHtml(s.user_avatar) + '" alt=""/>';
  document.getElementById('statusName').textContent = s.user_name;
  document.getElementById('statusTime').textContent = timeAgo(s.created_at);

  if (s.type === 'image') {
    body.innerHTML = '<img class="status-media" src="' + escapeHtml(s.file_path) + '" alt=""/>';
  } else {
    body.innerHTML = '<div class="status-text"></div>';
    body.firstChild.textContent = s.content || '';
  }

  var isMine = s.user_id === AC.authUser.id;
  document.getElementById('replyBtn').style.display = isMine ? 'none' : '';
  document.getElementById('mentionBtn').style.display = isMine ? 'none' : '';
  document.getElementById('deleteBtn').style.display = isMine ? '' : 'none';
}

function nextStatus() {
  var g = statusGroups[sgIdx];
  if (!g) return;
  if (siIdx < g.items.length - 1) { siIdx++; renderStatus(); }
  else if (sgIdx < statusGroups.length - 1) { sgIdx++; siIdx = 0; renderStatus(); }
  else closeStatus();
}
function prevStatus() {
  if (siIdx > 0) { siIdx--; renderStatus(); }
  else if (sgIdx > 0) { sgIdx--; siIdx = statusGroups[sgIdx].items.length - 1; renderStatus(); }
}
function closeStatus() { location.href = 'chat.html'; }

// ── Carga ───────────────────────────────────────────────────────────
function statusStartUser() {
  var m = /[?&]u=([^&]+)/.exec(location.search);
  return m ? decodeURIComponent(m[1]) : null;
}

function loadViewerStatuses() {
  var startUser = statusStartUser();
  acGetVisibleStatuses().then(function (statuses) {
    statuses = statuses || [];
    statusGroups = [];
    statuses.forEach(function (s) {
      var last = statusGroups[statusGroups.length - 1];
      if (!last || last.userId !== s.user_id) {
        last = {
          userId: s.user_id, userName: s.user_name, userColor: s.user_color,
          userAvatar: s.user_avatar, items: []
        };
        statusGroups.push(last);
      }
      last.items.push(s);
    });
    sgIdx = 0; siIdx = 0;
    for (var i = 0; i < statusGroups.length; i++) {
      if (statusGroups[i].userId === startUser) { sgIdx = i; break; }
    }
    renderStatus();
  }).catch(function (e) { acToastError(e, 'No se pudieron cargar los estados'); });
}

function loadStatusFriends() {
  acGetFriends().then(function (friends) { statusFriends = friends || []; })
    .catch(function () { statusFriends = []; });
}

// ── Compose (responder / mencionar) ─────────────────────────────────
function openCompose(mode) {
  composeMode = mode;
  var s = curStatus();
  if (!s) return;
  composeTarget = s;
  document.getElementById('composeTitle').textContent = mode === 'reply' ? 'Responder a ' + s.user_name : 'Mencionar a un amigo';
  document.getElementById('mentionPickWrap').style.display = mode === 'mention' ? '' : 'none';
  var pick = document.getElementById('mentionPick');
  if (mode === 'mention' && pick.options.length === 0) {
    statusFriends.forEach(function (f) {
      var o = document.createElement('option');
      o.value = f.id;
      o.textContent = f.display_name;
      pick.appendChild(o);
    });
  }
  document.getElementById('composeText').value = mode === 'mention' ? '@@' + s.user_name + ' ' : '';
  openModal('composeModal');
  document.getElementById('composeText').focus();
}

function sendCompose() {
  var text = document.getElementById('composeText').value.trim();
  if (!text) return;
  var targetId;
  var targetName;
  if (composeMode === 'reply') {
    targetId = composeTarget.user_id;
    targetName = composeTarget.user_name;
  } else {
    var fId = document.getElementById('mentionPick').value;
    if (!fId) { showToast('Elegí un amigo para mencionar.'); return; }
    targetId = fId;
    var f = statusFriends.filter(function (x) { return x.id === fId; })[0];
    targetName = f ? f.display_name : 'tu amigo';
  }
  acInsertDirectMessage(targetId, text, 'text', null, null, null, null)
    .then(function (m) {
      if (!m) { showToast('No se pudo enviar el mensaje.', 'error'); return; }
      closeModal('composeModal');
      showToast('Mensaje enviado a ' + targetName + '.', 'success');
    })
    .catch(function (e) { acToastError(e, 'No se pudo enviar el mensaje'); });
}

// ── Eliminar estado propio ──────────────────────────────────────────
function deleteStatus() {
  var s = curStatus();
  if (!s || !confirm('¿Eliminar este estado?')) return;
  acDeleteStatus(s.id).then(function () {
    showToast('Estado eliminado.');
    loadViewerStatuses();
    loadStatusStrip();
  }).catch(function (e) { acToastError(e, 'No se pudo eliminar el estado'); });
}

// ── Init ────────────────────────────────────────────────────────────
acInitApp(function () {
  window.acOnStatusChangeHook = function () { loadViewerStatuses(); };
  loadViewerStatuses();
  loadStatusFriends();

  document.getElementById('navPrev').addEventListener('click', prevStatus);
  document.getElementById('navNext').addEventListener('click', nextStatus);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeStatus(); return; }
    if (document.getElementById('composeModal').classList.contains('open')) return;
    if (e.key === 'ArrowRight') nextStatus();
    if (e.key === 'ArrowLeft') prevStatus();
  });
});
