// ═══════════════════════════════════════════════════════════════════
//  AeroChat · status-editor.js
//  ------------------------------------------------------------------
//  Editor de estados (status-editor.html): subir foto o video, agregar
//  stickers guardados (arrastrar / redimensionar / quitar), recortar la
//  duración del video (como WhatsApp) y publicar. Las ediciones se
//  "hornean" en el archivo final antes de subirlo a Storage.
//  ═══════════════════════════════════════════════════════════════════

var ed = {
  mode: 'photo',           // 'photo' | 'video'
  file: null,
  url: null,               // objectURL del original
  duration: 0,
  trimStart: 0,
  trimEnd: 0,
  stickers: [],            // { el, x, y, w, h } en % del preview
  selIdx: -1,
  baking: false,
  stickerData: null
};

function seBack() {
  if (ed.url) { try { URL.revokeObjectURL(ed.url); } catch (e) {} }
  location.href = 'status.html';
}

function fmt(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// ── Init (sesión liviana, sin sidebar) ───────────────────────────────
function seInit() {
  AC.supabase.auth.getSession().then(function (r) {
    var session = r.data && r.data.session;
    if (!session) { location.replace('index.html'); return; }
    AC.session = session;
    AC.authUser = session.user;
    document.body.setAttribute('data-userid', AC.authUser.id);
    return AC.supabase.from('profiles').select('*').eq('id', AC.authUser.id).maybeSingle();
  }).then(function (p) {
    AC.me = p && p.data ? p.data : { id: AC.authUser.id, display_name: '', avatar_color: '#6C63FF' };
    var m = /[?&]type=([^&]+)/.exec(location.search);
    ed.mode = m && m[1] === 'video' ? 'video' : 'photo';
    var draft = '';
    try { draft = localStorage.getItem('ac-status-draft') || ''; } catch (e) {}
    if (draft) {
      var cap = document.getElementById('seCaption');
      if (cap) cap.value = draft;
      try { localStorage.removeItem('ac-status-draft'); } catch (e) {}
    }
    bindEditor();
    loadStickerTray();
  }).catch(function (e) {
    console.error('AeroChat: editor', e);
    showToast('No se pudo iniciar el editor.', 'error');
  });
}

// ── Selección de archivo ─────────────────────────────────────────────
function sePickFile(input, kind) {
  var f = input && input.files && input.files[0];
  if (!f) return;
  if (kind === 'image' && !/^image\//.test(f.type)) { showToast('Elegí un archivo de imagen.'); return; }
  if (kind === 'video' && !/^video\//.test(f.type)) { showToast('Elegí un archivo de video.'); return; }
  ed.mode = kind;
  ed.file = f;
  if (ed.url) { try { URL.revokeObjectURL(ed.url); } catch (e) {} }
  ed.url = URL.createObjectURL(f);
  ed.trimStart = 0;
  ed.trimEnd = 0;
  ed.duration = 0;
  ed.stickers = [];
  ed.selIdx = -1;
  document.getElementById('sePick').hidden = true;
  document.getElementById('seEditor').hidden = false;
  var img = document.getElementById('sePreviewImg');
  var vid = document.getElementById('sePreviewVideo');
  if (kind === 'video') {
    img.hidden = true;
    vid.hidden = false;
    vid.src = ed.url;
    vid.onloadedmetadata = function () {
      ed.duration = vid.duration || 0;
      ed.trimStart = 0;
      ed.trimEnd = ed.duration;
      setupTrim();
      document.getElementById('seTrim').hidden = false;
    };
  } else {
    img.hidden = false;
    vid.hidden = true;
    vid.pause();
    vid.removeAttribute('src');
    vid.load();
    document.getElementById('seTrim').hidden = true;
    img.onload = function () { ed.duration = 0; };
    img.src = ed.url;
  }
}

// ── Recorte de video ─────────────────────────────────────────────────
function setupTrim() {
  var st = document.getElementById('seTrimStart');
  var en = document.getElementById('seTrimEnd');
  var max = Math.max(0, Math.floor(ed.duration * 100) / 100);
  st.max = en.max = max;
  st.value = 0;
  en.value = max;
  document.getElementById('seDurLabel').textContent = 'Duración: ' + fmt(ed.duration);
  updateTrimLabel();
}
function updateTrimLabel() {
  document.getElementById('seTrimLabel').textContent = fmt(ed.trimStart) + ' – ' + fmt(ed.trimEnd);
}
function seekPreview(t) {
  var vid = document.getElementById('sePreviewVideo');
  if (vid && vid.readyState) { try { vid.currentTime = t; } catch (e) {} }
}

function bindEditor() {
  var st = document.getElementById('seTrimStart');
  var en = document.getElementById('seTrimEnd');
  st.addEventListener('input', function () {
    var v = parseFloat(st.value) || 0;
    ed.trimStart = v;
    if (ed.trimEnd - ed.trimStart < 0.3) ed.trimEnd = Math.min(ed.duration, ed.trimStart + 0.3);
    en.value = ed.trimEnd;
    seekPreview(ed.trimStart);
    updateTrimLabel();
  });
  en.addEventListener('input', function () {
    var v = parseFloat(en.value) || 0;
    ed.trimEnd = v;
    if (ed.trimEnd - ed.trimStart < 0.3) ed.trimStart = Math.max(0, ed.trimEnd - 0.3);
    st.value = ed.trimStart;
    seekPreview(ed.trimStart);
    updateTrimLabel();
  });
  document.getElementById('seTrimPlay').addEventListener('click', function () {
    var vid = document.getElementById('sePreviewVideo');
    if (!vid || !ed.duration) return;
    var stopAt = ed.trimEnd;
    vid.pause();
    vid.currentTime = ed.trimStart;
    vid.play();
    var check = function () {
      if (vid.currentTime >= stopAt) { vid.pause(); vid.removeEventListener('timeupdate', check); }
    };
    vid.addEventListener('timeupdate', check);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') seBack();
  });
}

// ── Stickers (arrastrar / redimensionar / quitar) ────────────────────
function previewRect() {
  var r = document.getElementById('sePreview').getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}
function positionSticker(st, x, y, w, h) {
  st.x = Math.max(0, Math.min(100, x));
  st.y = Math.max(0, Math.min(100, y));
  st.w = Math.max(6, w);
  st.h = Math.max(6, h);
  st.el.style.left = st.x + '%';
  st.el.style.top = st.y + '%';
  st.el.style.width = st.w + '%';
  st.el.style.height = st.h + '%';
}
function selectSticker(i) {
  ed.stickers.forEach(function (s, idx) { s.el.classList.toggle('selected', idx === i); });
  ed.selIdx = i;
}

function bindStickerEl(el, st) {
  var overlay = document.getElementById('seOverlay');

  el.addEventListener('pointerdown', function (e) {
    if (e.target.classList.contains('ed-sticker-del') || e.target.classList.contains('ed-sticker-resize')) return;
    e.preventDefault();
    var idx = ed.stickers.indexOf(st);
    selectSticker(idx);
    var rect = overlay.getBoundingClientRect();
    var ox = e.clientX, oy = e.clientY;
    var sx = st.x, sy = st.y;
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    function move(ev) {
      var dx = (ev.clientX - ox) / rect.width * 100;
      var dy = (ev.clientY - oy) / rect.height * 100;
      positionSticker(st, sx + dx, sy + dy, st.w, st.h);
    }
    function up() {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    }
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });

  var rs = el.querySelector('.ed-sticker-resize');
  rs.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var idx = ed.stickers.indexOf(st);
    selectSticker(idx);
    var rect = overlay.getBoundingClientRect();
    var ox = e.clientX, oy = e.clientY;
    var sw = st.w, sh = st.h;
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    function move(ev) {
      var dw = (ev.clientX - ox) / rect.width * 100;
      var dh = (ev.clientY - oy) / rect.height * 100;
      positionSticker(st, st.x, st.y, sw + dw, sh + dh);
    }
    function up() {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    }
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });

  el.querySelector('.ed-sticker-del').addEventListener('click', function (e) {
    e.stopPropagation();
    ed.stickers.splice(ed.stickers.indexOf(st), 1);
    ed.selIdx = -1;
    el.remove();
  });
}

function edAddSticker(path) {
  var overlay = document.getElementById('seOverlay');
  var el = document.createElement('div');
  el.className = 'ed-sticker';
  el.innerHTML = '<img src="' + escapeHtml(path) + '" alt=""/>' +
    '<button type="button" class="ed-sticker-del" title="Quitar sticker">' + acIcon('close', 10) + '</button>' +
    '<span class="ed-sticker-resize" title="Redimensionar"></span>';
  overlay.appendChild(el);
  var st = { el: el, x: 35, y: 35, w: 30, h: 30 };
  positionSticker(st, 35, 35, 30, 30);
  ed.stickers.push(st);
  selectSticker(ed.stickers.length - 1);
  bindStickerEl(el, st);
}

function edClearStickers() {
  ed.stickers.forEach(function (s) { s.el.remove(); });
  ed.stickers = [];
  ed.selIdx = -1;
}

// ── Tray de stickers guardados ───────────────────────────────────────
function loadStickerTray() {
  var tray = document.getElementById('seStickerTray');
  if (!tray) return;
  tray.innerHTML = '<div class="sticker-empty">Cargando stickers…</div>';
  Promise.all([acGetStickerPacks(), acGetStickerFavorites(), acGetStickerUsage()])
    .then(function (res) {
      var packs = res[0] || [];
      var favs = res[1] || [];
      var usage = res[2] || {};
      var favSet = {};
      favs.forEach(function (p) { favSet[p] = 1; });
      return Promise.all(packs.map(function (pk) {
        return acListStickers(AC.me.id + '/' + pk.pack_id).then(function (files) {
          return {
            pack_id: pk.pack_id,
            name: pk.name,
            stickers: (files || []).map(function (f) {
              var path = acPublicUrl('stickers', AC.me.id + '/' + pk.pack_id + '/' + f.name);
              return {
                path: path,
                name: f.name,
                animated: /\.(gif|webp)$/i.test(f.name || ''),
                fav: !!favSet[path],
                uses: usage[path] || 0
              };
            })
          };
        });
      }));
    })
    .then(function (packs) {
      packs = (packs || []).filter(function (p) { return p.stickers.length > 0; });
      ed.stickerData = buildStickerData(packs);
      renderStickerTabs();
      renderStickerTray('fav');
    })
    .catch(function (e) {
      console.error('AeroChat: stickers editor', e);
      tray.innerHTML = '<div class="sticker-empty">No se pudieron cargar tus stickers</div>';
    });
}

function renderStickerTabs() {
  var bar = document.getElementById('seStickerTabs');
  if (!bar) return;
  var data = ed.stickerData;
  if (!data || !data.packs.length) { bar.innerHTML = ''; return; }
  var html = '<button type="button" class="se-sticker-tab" data-tab="fav">' + acIcon('star-fill', 12) + ' Favoritos</button>' +
    '<button type="button" class="se-sticker-tab" data-tab="used">' + acIcon('clock', 12) + ' Recientes</button>';
  data.packs.forEach(function (p, i) {
    html += '<button type="button" class="se-sticker-tab" data-tab="p' + i + '">' + escapeHtml(p.name) + '</button>';
  });
  bar.innerHTML = html;
  bar.querySelectorAll('.se-sticker-tab').forEach(function (t) {
    t.onclick = function () {
      bar.querySelectorAll('.se-sticker-tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      renderStickerTray(t.getAttribute('data-tab'));
    };
  });
  var fav = bar.querySelector('[data-tab="fav"]');
  if (fav) fav.classList.add('active');
}

function renderStickerTray(tab) {
  var tray = document.getElementById('seStickerTray');
  if (!tray) return;
  var data = ed.stickerData;
  if (!data || !data.packs.length) {
    tray.innerHTML = '<div class="sticker-empty">No tenés stickers todavía. Importá un paquete con sticker.ly desde el chat.</div>';
    return;
  }
  var items;
  if (tab === 'fav') items = data.favs;
  else if (tab === 'used') items = data.used;
  else items = data.packs[parseInt(tab.slice(1), 10)].stickers.map(function (s) { return { sticker: s }; });
  if (!items.length) { tray.innerHTML = '<div class="sticker-empty">No hay stickers acá</div>'; return; }
  tray.innerHTML = items.map(function (x) {
    var s = x.sticker;
    return '<button type="button" class="se-sticker-cell" onclick="edAddSticker(\'' + jsEncode(s.path) + '\')" title="Agregar sticker">' +
      '<img src="' + escapeHtml(s.path) + '" alt="" loading="lazy"/></button>';
  }).join('');
}

// ── Horneado final (imagen) ──────────────────────────────────────────
function drawStickersOn(ctx, cw, ch) {
  var pr = previewRect();
  ed.stickers.forEach(function (st) {
    var el = st.el;
    var r = el.getBoundingClientRect();
    var img = el.querySelector('img');
    if (!img || !pr.w || !pr.h) return;
    var x = (r.left - pr.x) / pr.w * cw;
    var y = (r.top - pr.y) / pr.h * ch;
    var w = (r.width / pr.w) * cw;
    var h = (r.height / pr.h) * ch;
    try { ctx.drawImage(img, x, y, w, h); } catch (e) {}
  });
}

function bakeImage() {
  return new Promise(function (resolve, reject) {
    var img = document.getElementById('sePreviewImg');
    if (!img.naturalWidth || !img.naturalHeight) { reject(new Error('La imagen no está lista.')); return; }
    var canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    var pr = previewRect();
    var srcRatio = img.naturalWidth / img.naturalHeight;
    var prRatio = pr.w / pr.h;
    var sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (srcRatio > prRatio) { sw = img.naturalHeight * prRatio; sx = (img.naturalWidth - sw) / 2; }
    else { sh = img.naturalWidth / prRatio; sy = (img.naturalHeight - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    drawStickersOn(ctx, canvas.width, canvas.height);
    canvas.toBlob(function (b) {
      if (b) resolve(b);
      else reject(new Error('No se pudo generar la imagen final.'));
    }, 'image/jpeg', 0.92);
  });
}

// ── Horneado final (video: recorte + stickers + audio) ───────────────
function pickRecorderMime() {
  var types = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  for (var i = 0; i < types.length; i++) {
    try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(types[i])) return types[i]; } catch (e) {}
  }
  return '';
}

function bakeVideo() {
  return new Promise(function (resolve, reject) {
    var vid = document.getElementById('sePreviewVideo');
    if (!ed.duration) { reject(new Error('El video no está listo.')); return; }
    var start = Math.max(0, ed.trimStart);
    var end = Math.min(ed.duration, ed.trimEnd);
    if (end - start < 0.3) end = Math.min(ed.duration, start + 0.3);
    if (end <= start) { reject(new Error('El recorte es inválido.')); return; }
    var dur = end - start;

    var canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth || 1280;
    canvas.height = vid.videoHeight || 720;
    var ctx = canvas.getContext('2d');
    var mime = pickRecorderMime();
    if (!window.MediaRecorder) { reject(new Error('Tu navegador no permite editar videos.')); return; }

    var stream, rec;
    try {
      stream = canvas.captureStream(30);
      var srcStream = vid.captureStream();
      (srcStream.getAudioTracks() || []).forEach(function (t) { stream.addTrack(t); });
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 });
    } catch (e) {
      reject(new Error('Tu navegador no permite recortar videos. Probá con Chrome o Edge.'));
      return;
    }

    var chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      vid.pause();
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      var type = (rec.mimeType || mime || 'video/webm').split(';')[0];
      resolve(new Blob(chunks, { type: type }));
    };

    var pr = previewRect();
    function frame() {
      try {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        var vw = vid.videoWidth, vh = vid.videoHeight;
        var srcRatio = vw / vh;
        var prRatio = pr.w / pr.h;
        var sx = 0, sy = 0, sw = vw, sh = vh;
        if (srcRatio > prRatio) { sw = vh * prRatio; sx = (vw - sw) / 2; }
        else { sh = vw / prRatio; sy = (vh - sh) / 2; }
        ctx.drawImage(vid, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        drawStickersOn(ctx, canvas.width, canvas.height);
      } catch (e) {}
      if (rec && rec.state === 'recording') requestAnimationFrame(frame);
    }

    vid.onended = function () {
      try { if (rec.state === 'recording') rec.stop(); } catch (e) {}
    };
    vid.addEventListener('seeked', function () {
      frame();
      rec.start(250);
      vid.play();
      setTimeout(function () {
        if (rec.state === 'recording') rec.stop();
      }, Math.round(dur * 1000));
    }, { once: true });
    vid.currentTime = start;
  });
}

// ── Publicar ─────────────────────────────────────────────────────────
function sePublish() {
  if (ed.baking) return;
  var btn = document.getElementById('sePublish');
  var caption = (document.getElementById('seCaption').value || '').trim();
  var finish = function (blob, type) {
    var ext = type === 'video' ? (/mp4/i.test(blob.type) ? 'mp4' : 'webm') : 'jpg';
    var path = AC.authUser.id + '/status-' + acRandomId() + '.' + ext;
    var file = new File([blob], 'estado.' + ext, { type: blob.type });
    return acUpload('statuses', path, file)
      .then(function (url) { return acAddStatus(caption, type, url, file.name); });
  };
  var onOk = function () {
    showToast('Estado publicado.', 'success');
    setTimeout(function () { location.href = 'status.html'; }, 500);
  };
  var onErr = function (e) {
    ed.baking = false;
    btn.disabled = false;
    btn.textContent = 'Publicar';
    showToast('No se pudo publicar: ' + ((e && e.message) || 'error'), 'error');
  };

  ed.baking = true;
  btn.disabled = true;
  btn.textContent = 'Procesando…';

  if (ed.mode === 'video') {
    bakeVideo().then(function (blob) { return finish(blob, 'video'); }).then(onOk).catch(onErr);
  } else {
    bakeImage().then(function (blob) { return finish(blob, 'image'); }).then(onOk).catch(onErr);
  }
}

document.addEventListener('DOMContentLoaded', seInit);
