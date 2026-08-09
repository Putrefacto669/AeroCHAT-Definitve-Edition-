// ═══════════════════════════════════════════════════════════════════
//  AeroChat · profile.js (perfil de usuario)
//  ------------------------------------------------------------------
//  Página profile.html?u={id}: banner, avatar, datos, botón de amistad,
//  canción favorita (YouTube) y lista de amigos. Si es mi propio perfil,
//  permite subir avatar/banner directamente a Storage.
//  ═══════════════════════════════════════════════════════════════════

var profileUserId = null;
var profileData = null;

function acYoutubeId(url) {
  if (!url) return null;
  var host = '';
  try { host = new URL(url).host; } catch (e) { return null; }
  if (host.indexOf('youtu.be') >= 0) return url.split('/').pop().split('?')[0];
  if (host.indexOf('youtube.com') >= 0 || host.indexOf('youtube-nocookie.com') >= 0) {
    var m = /[?&]v=([A-Za-z0-9_-]{6,})/.exec(url);
    if (m) return m[1];
    var p = url.split('/').pop().split('?')[0];
    return p && p.length >= 6 ? p : null;
  }
  return null;
}

function renderProfilePresence() {
  var online = !!AC.online[profileUserId];
  var el = document.getElementById('profileOnline');
  if (el) {
    el.textContent = online ? '· en línea' : '';
    el.classList.toggle('online', online);
  }
  var dot = document.getElementById('profileDot');
  if (dot) dot.classList.toggle('online', online);
}
document.addEventListener('ac:presence', renderProfilePresence);

function renderProfile() {
  if (!profileData || !profileData.profile) return;
  var p = profileData.profile;

  var banner = document.getElementById('bannerDiv');
  banner.style.backgroundImage = p.banner_path ? "url('" + p.banner_path.replace(/'/g, '%27') + "')" : '';
  banner.style.backgroundSize = 'cover';
  banner.style.backgroundPosition = 'center';

  var av = document.getElementById('profileAvatar');
  if (p.avatar_path) av.innerHTML = '<img src="' + escapeHtml(p.avatar_path) + '" class="avatar avatar-lg" alt=""/>';
  else { av.style.background = p.avatar_color || '#6C63FF'; av.textContent = (p.display_name || '?').charAt(0).toUpperCase(); }

  document.getElementById('profileName').textContent = p.display_name || p.username;
  document.getElementById('profileUsername').textContent = '@' + (p.username || '');
  var dot = document.getElementById('profileDot');
  dot.setAttribute('data-userid', profileUserId);
  document.title = (p.display_name || 'Perfil') + ' — AeroChat';

  var st = document.getElementById('profileStatus');
  st.hidden = !p.status;
  st.textContent = p.status || '';

  var isOwn = profileUserId === AC.authUser.id;
  document.getElementById('avatarEditWrap').hidden = !isOwn;
  document.getElementById('bannerEditWrap').hidden = !isOwn;

  // Canción de YouTube
  var yt = acYoutubeId(p.youtube_song_url);
  var ys = document.getElementById('youtubeSection');
  if (yt) {
    ys.hidden = false;
    document.getElementById('youtubeFrame').src = 'https://www.youtube.com/embed/' + yt + '?rel=0&modestbranding=1';
  } else {
    ys.hidden = true;
    document.getElementById('youtubeFrame').removeAttribute('src');
  }

  // Botón de amistad
  var wrap = document.getElementById('profileFriendActions');
  wrap.setAttribute('data-userid', profileUserId);
  wrap.setAttribute('data-isown', isOwn ? '1' : '0');
  wrap.setAttribute('data-requestid', profileData.request_id || '');
  if (isOwn) {
    wrap.innerHTML = '<a href="edit-profile.html" class="btn btn-secondary">✏ Editar perfil</a>';
  } else {
    renderProfileFriendActions(profileData.friend_state || 'none');
  }

  // Amigos
  var friends = profileData.friends || [];
  document.getElementById('friendCountTitle').textContent = '(' + friends.length + ')';
  var grid = document.getElementById('friendsGrid');
  if (friends.length) {
    grid.innerHTML = friends.map(function (f) {
      return '<a href="profile.html?u=' + f.id + '" class="friend-card" title="' + escapeHtml(f.display_name) + '">' +
        '<span class="avatar-wrap">' + acAvatarHtml(f, 'avatar avatar-md') +
        '<span class="presence-dot" data-userid="' + f.id + '"></span></span>' +
        '<span class="friend-card-name">' + escapeHtml(f.display_name) + '</span></a>';
    }).join('');
  } else {
    grid.innerHTML = '<div class="sidebar-empty">' +
      (isOwn ? 'Todavía no tenés amigos. Agregá gente desde el menú lateral.' : 'No tiene amigos todavía.') +
      '</div>';
  }
  renderProfilePresence();
}

function loadProfile() {
  var m = /[?&]u=([^&]+)/.exec(location.search);
  profileUserId = m ? decodeURIComponent(m[1]) : (AC.authUser ? AC.authUser.id : null);
  if (!profileUserId) { location.href = 'chat.html'; return; }
  acGetProfile(profileUserId).then(function (d) {
    if (!d || !d.profile) { showToast('No se encontró el perfil.', 'error'); setTimeout(function () { location.href = 'chat.html'; }, 1200); return; }
    profileData = d;
    renderProfile();
  }).catch(function (e) { acToastError(e, 'No se pudo cargar el perfil'); });
}

// ── Subidas (solo mi propio perfil) ─────────────────────────────────
function profileAvatarChanged(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  input.disabled = true;
  var path = AC.authUser.id + '/avatar-' + acRandomId() + '.' + acExt(file.name);
  acUpload('avatars', path, file).then(function (url) {
    return acSetAvatar(url);
  }).then(function () {
    profileData.profile.avatar_path = acPublicUrl('avatars', path);
    renderProfile();
    acRefreshSidebar();
    showToast('Foto de perfil actualizada.', 'success');
  }).catch(function (e) { acToastError(e, 'No se pudo subir la foto'); })
    .then(function () { input.disabled = false; input.value = ''; });
}

function profileBannerChanged(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  input.disabled = true;
  var path = AC.authUser.id + '/banner-' + acRandomId() + '.' + acExt(file.name);
  acUpload('banners', path, file).then(function (url) {
    return acSetBanner(url);
  }).then(function () {
    profileData.profile.banner_path = acPublicUrl('banners', path);
    renderProfile();
    showToast('Banner actualizado.', 'success');
  }).catch(function (e) { acToastError(e, 'No se pudo subir el banner'); })
    .then(function () { input.disabled = false; input.value = ''; });
}

acInitApp(function () {
  loadProfile();
});
