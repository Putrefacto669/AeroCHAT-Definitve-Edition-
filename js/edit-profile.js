// ═══════════════════════════════════════════════════════════════════
//  AeroChat · edit-profile.js
//  ------------------------------------------------------------------
//  Página edit-profile.html: edita display_name, estado y canción de
//  YouTube, y sube avatar/banner a Storage (carpeta propia por RLS).
//  ═══════════════════════════════════════════════════════════════════

var editMe = null;

function renderEditProfile() {
  if (!editMe) return;
  var p = editMe;
  var banner = document.getElementById('bannerPreview');
  banner.style.backgroundImage = p.banner_path ? "url('" + p.banner_path.replace(/'/g, '%27') + "')" : '';
  banner.style.backgroundSize = 'cover';
  banner.style.backgroundPosition = 'center';

  var av = document.getElementById('avatarPreview');
  if (p.avatar_path) av.innerHTML = '<img src="' + escapeHtml(p.avatar_path) + '" class="avatar avatar-lg" alt=""/>';
  else { av.style.background = p.avatar_color || '#6C63FF'; av.textContent = (p.display_name || '?').charAt(0).toUpperCase(); }

  document.getElementById('displayName').value = p.display_name || '';
  document.getElementById('status').value = p.status || '';
  document.getElementById('youtubeSongUrl').value = p.youtube_song_url || '';
}

// ── Guardar ─────────────────────────────────────────────────────────
function saveProfile() {
  var displayName = (document.getElementById('displayName').value || '').trim();
  var status = document.getElementById('status').value.trim();
  var yt = document.getElementById('youtubeSongUrl').value.trim();
  if (!displayName) { showError('El nombre no puede estar vacío.'); return; }
  var btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = '…';
  acUpdateProfile(displayName, status, yt).then(function (ok) {
    if (!ok) throw new Error('No se pudo guardar el perfil.');
    showToast('Perfil actualizado.', 'success');
    setTimeout(function () { location.href = 'profile.html?u=' + AC.authUser.id; }, 600);
  }).catch(function (e) {
    acToastError(e, 'No se pudo guardar el perfil');
    btn.disabled = false;
    btn.textContent = 'Guardar cambios';
  });
}

// ── Subidas ─────────────────────────────────────────────────────────
function editAvatarChanged(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  input.disabled = true;
  var path = AC.authUser.id + '/avatar-' + acRandomId() + '.' + acExt(file.name);
  acUpload('avatars', path, file).then(function (url) {
    return acSetAvatar(url);
  }).then(function () {
    editMe.avatar_path = acPublicUrl('avatars', path);
    renderEditProfile();
    acRefreshSidebar();
    showToast('Foto de perfil actualizada.', 'success');
  }).catch(function (e) { acToastError(e, 'No se pudo subir la foto'); })
    .then(function () { input.disabled = false; input.value = ''; });
}

function editBannerChanged(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  input.disabled = true;
  var path = AC.authUser.id + '/banner-' + acRandomId() + '.' + acExt(file.name);
  acUpload('banners', path, file).then(function (url) {
    return acSetBanner(url);
  }).then(function () {
    editMe.banner_path = acPublicUrl('banners', path);
    renderEditProfile();
    showToast('Banner actualizado.', 'success');
  }).catch(function (e) { acToastError(e, 'No se pudo subir el banner'); })
    .then(function () { input.disabled = false; input.value = ''; });
}

function showError(msg) {
  var el = document.getElementById('editError');
  el.hidden = !msg;
  el.textContent = msg || '';
}

acInitApp(function () {
  acGetProfile(AC.authUser.id).then(function (d) {
    if (!d || !d.profile) { location.href = 'chat.html'; return; }
    editMe = d.profile;
    renderEditProfile();
  }).catch(function (e) { acToastError(e, 'No se pudo cargar el perfil'); });

  document.getElementById('editForm').addEventListener('submit', function (e) { e.preventDefault(); saveProfile(); });
});
