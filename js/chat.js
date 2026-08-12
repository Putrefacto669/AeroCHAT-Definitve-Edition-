// ═══════════════════════════════════════════════════════════════════
//  AeroChat · chat.js (conversación directa)
//  ------------------------------------------------------------------
//  Página conversation.html: carga el contacto y la conversación,
//  configura AC.view, render de mensajes, envío, typing, búsqueda,
//  presencia en el header y botones de llamada.
//  ═══════════════════════════════════════════════════════════════════

var chatPartnerId = null;
var chatPartner = null;

function chatParams() {
  var m = /[?&]u=([^&]+)/.exec(location.search);
  return m ? decodeURIComponent(m[1]) : null;
}

function chatSetHeader() {
  var p = chatPartner || {};
  var av = document.getElementById('headerAvatar');
  if (av) {
    if (p.avatar_path) av.innerHTML = '<img src="' + escapeHtml(p.avatar_path) + '" class="avatar avatar-md" alt=""/>';
    else { av.style.background = p.avatar_color || '#6C63FF'; av.textContent = (p.display_name || '?').charAt(0).toUpperCase(); }
  }
  var link = document.getElementById('headerLink');
  if (link) link.setAttribute('href', 'profile.html?u=' + chatPartnerId);
  var name = document.getElementById('headerName');
  if (name) name.textContent = p.display_name || '…';
  var dot = document.getElementById('headerDot');
  if (dot) dot.setAttribute('data-userid', chatPartnerId);
  document.title = 'Chat — ' + (p.display_name || '') + ' — AeroChat';
  chatRenderPresence();
}

function chatRenderPresence() {
  var online = !!AC.online[chatPartnerId];
  var sub = document.getElementById('headerSub');
  if (!sub) return;
  if (online) sub.textContent = 'en línea';
  else sub.textContent = chatPartner ? (chatPartner.status || ('@' + chatPartner.username)) : '';
  var dot = document.getElementById('headerDot');
  if (dot) dot.classList.toggle('online', online);
}
document.addEventListener('ac:presence', chatRenderPresence);

function chatLoadPartner() {
  chatPartner = AC.usersById[chatPartnerId] || null;
  if (chatPartner) { AC.view.partner = chatPartner; chatSetHeader(); return Promise.resolve(chatPartner); }
  return AC.supabase.from('profiles')
    .select('id, username, display_name, avatar_color, avatar_path, status')
    .eq('id', chatPartnerId).maybeSingle().then(function (r) {
      if (!r.error && r.data) {
        chatPartner = r.data;
        AC.view.partner = chatPartner;
        chatSetHeader();
        return chatPartner;
      }
      AC.view.partner = null;
      return null;
    });
}

function chatLoadMessages() {
  return acGetConversation(chatPartnerId).then(function (msgs) {
    var area = document.getElementById('messages');
    if (area) area.innerHTML = '';
    (msgs || []).forEach(function (m) {
      addMessageToArea(m);
    });
    if (!(msgs || []).length) {
      var el = document.createElement('div');
      el.className = 'no-messages';
      el.textContent = 'Nada por acá todavía — ¡arrancá la conversación!';
      var area2 = document.getElementById('messages');
      if (area2) area2.appendChild(el);
    }
    scrollToBottom();
    acMarkDirectRead(chatPartnerId);
  });
}

function chatInit() {
  chatPartnerId = chatParams();
  if (!chatPartnerId) { location.replace('chat.html'); return; }

  AC.view = { kind: 'direct', id: chatPartnerId, me: AC.me };

  chatLoadPartner().then(function () {
    return chatLoadMessages();
  }).catch(function (e) { acToastError(e, 'No se pudo cargar la conversación'); });

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
    acTypingSend({ to: chatPartnerId, from: AC.authUser.id, name: AC.me ? AC.me.display_name : '' });
    typingTimer = setTimeout(function () { acTypingStop({ to: chatPartnerId, from: AC.authUser.id }); }, 1200);
  });

  // Búsqueda
  acBindSearch(function (q) { return acSearchDirect(chatPartnerId, q); });

  // Llamadas
  document.getElementById('callAudioBtn').addEventListener('click', function () {
    callFriend(chatPartnerId, chatPartner.display_name, chatPartner.avatar_path, chatPartner.avatar_color, 'audio');
  });
  document.getElementById('callVideoBtn').addEventListener('click', function () {
    callFriend(chatPartnerId, chatPartner.display_name, chatPartner.avatar_path, chatPartner.avatar_color, 'video');
  });

  // Marcar leído al abrir
  acMarkDirectRead(chatPartnerId);
}

acInitApp(function () {
  acInitCalls();
  chatInit();
});
