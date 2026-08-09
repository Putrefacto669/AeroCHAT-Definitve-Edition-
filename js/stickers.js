// ═══════════════════════════════════════════════════════════════════
//  AeroChat · stickers.js
//  ------------------------------------------------------------------
//  Panel de stickers compartido entre DM y grupos. Reemplaza el flujo
//  original de /Sticker/List + /Sticker/Import con:
//    · Listado: metadata de sticker_packs + Storage.list de la carpeta
//      stickers/{miId}/{packId}
//    · Favoritos/uso: RPCs toggle_sticker_favorite / get_sticker_usage
//    · Importación: Edge Function import-sticker (sticker.ly)
//  ═══════════════════════════════════════════════════════════════════

var stickerOpen = false;
var stickerData = null;
var stickerTab = 'fav';

function toggleStickers() {
  stickerOpen = !stickerOpen;
  var panel = document.getElementById('stickerPanel');
  if (!panel) return;
  panel.hidden = !stickerOpen;
  var stBtn = document.querySelector('.icon-btn-sticker');
  if (stBtn) stBtn.classList.toggle('active', stickerOpen);
  if (stickerOpen) {
    var gifPanel = document.getElementById('gifPanel');
    if (gifPanel) gifPanel.hidden = true;
    var gifBtn = document.getElementById('gifBtn');
    if (gifBtn) gifBtn.classList.remove('active');
    if (!stickerData) loadStickers();
  }
}

function loadStickers() {
  var body = document.getElementById('stickerPanelBody');
  if (!body) return;
  body.innerHTML = '<div class="sticker-empty">Cargando…</div>';

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
      stickerData = buildStickerData(packs);
      if (!stickerData.packs.length) {
        body.innerHTML = '<div class="sticker-empty">No hay stickers aún. Importa un paquete pegando su link de sticker.ly.</div>';
        return;
      }
      renderStickerTabs();
      selectStickerTab('fav');
    })
    .catch(function (e) {
      console.error('AeroChat: stickers', e);
      body.innerHTML = '<div class="sticker-empty">No se pudieron cargar los stickers</div>';
    });
}

function buildStickerData(packs) {
  var all = [];
  packs.forEach(function (p) {
    p.stickers.forEach(function (s) { all.push({ sticker: s }); });
  });
  var favs = all.filter(function (x) { return x.sticker.fav; });
  var used = all.filter(function (x) { return x.sticker.uses > 0; })
    .sort(function (a, b) { return b.sticker.uses - a.sticker.uses; })
    .slice(0, 15);
  return { packs: packs, all: all, favs: favs, used: used };
}

function renderStickerTabs() {
  var bar = document.getElementById('stickerTabs');
  if (!bar) return;
  var html = '<button type="button" class="sticker-tab" data-tab="fav">' + acIcon('star-fill', 12) + ' Favoritos</button>' +
    '<button type="button" class="sticker-tab" data-tab="used">' + acIcon('clock', 12) + ' Recientes</button>';
  stickerData.packs.forEach(function (p, i) {
    html += '<button type="button" class="sticker-tab" data-tab="p' + i + '">' + htmlEncode(p.name) + '</button>';
  });
  bar.innerHTML = html;
  bar.querySelectorAll('.sticker-tab').forEach(function (t) {
    t.onclick = function () { selectStickerTab(t.getAttribute('data-tab')); };
  });
}

function stickerGrid(items) {
  if (!items.length) return '<div class="sticker-empty">No hay stickers aquí</div>';
  return items.map(function (x) {
    var s = x.sticker;
    return '<div class="sticker-cell" onclick="sendSticker(\'' + s.path + '\')" title="' + htmlEncode(s.name) + '">' +
      '<img src="' + s.path + '" alt="' + htmlEncode(s.name) + '" loading="lazy"/>' +
      '<button type="button" class="sticker-fav' + (s.fav ? ' on' : '') + '" onclick="event.stopPropagation();toggleFavorite(\'' + s.path + '\', this)">' + acIcon(s.fav ? 'star-fill' : 'star', 13) + '</button>' +
      '</div>';
  }).join('');
}

function selectStickerTab(tab) {
  stickerTab = tab;
  var bar = document.getElementById('stickerTabs');
  if (bar) {
    bar.querySelectorAll('.sticker-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === tab);
    });
  }
  var body = document.getElementById('stickerPanelBody');
  if (!body) return;
  var items;
  if (tab === 'fav') items = stickerData.favs;
  else if (tab === 'used') items = stickerData.used;
  else items = stickerData.packs[parseInt(tab.slice(1), 10)].stickers.map(function (s) { return { sticker: s }; });
  body.innerHTML = stickerGrid(items);
}

function updateFavoriteFlag(path, on) {
  stickerData.all.forEach(function (x) { if (x.sticker.path === path) x.sticker.fav = on; });
  stickerData.favs = stickerData.all.filter(function (x) { return x.sticker.fav; });
}

function toggleFavorite(path, btn) {
  acToggleStickerFavorite(path).then(function (on) {
    if (btn) btn.innerHTML = acIcon(on ? 'star-fill' : 'star', 13);
    btn.classList.toggle('on', on);
    updateFavoriteFlag(path, on);
    if (stickerTab === 'fav' || stickerTab === 'used') selectStickerTab(stickerTab);
  }).catch(function () { showToast('No se pudo actualizar el favorito', 'error'); });
}

function sendSticker(path) {
  stickerOpen = false;
  var panel = document.getElementById('stickerPanel');
  if (panel) panel.hidden = true;
  acSendSticker(path);
}

function importStickerPack() {
  var input = document.getElementById('stickerLink');
  var url = (input.value || '').trim();
  if (!url) return;
  var btn = document.querySelector('.sticker-import-btn');
  var old = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '…'; }

  function done() { if (btn) { btn.disabled = false; btn.innerHTML = old; } }

  function onSuccess(d) {
    showToast('Paquete importado: ' + d.name + ' (' + d.count + ' stickers)', 'success');
    stickerData = null;
    loadStickers();
    input.value = '';
  }

  acImportStickerPack(url)
    .then(onSuccess)
    .catch(function (err) {
      console.warn('AeroChat: Edge Function no disponible, importando desde el navegador…', err && err.message);
      return importStickerPackClient(url).then(onSuccess);
    })
    .catch(function (err2) {
      var msg = (err2 && err2.message) || 'No se pudo importar';
      showToast('No se pudo importar: ' + msg, 'error');
    })
    .then(done);
}

// ── Importación directa desde el navegador (sticker.ly) ─────────────
// Respaldo cuando la Edge Function import-sticker no está desplegada.
// La API de sticker.ly y su CDN permiten CORS (Access-Control-Allow-Origin: *).
function stickerlyPackId(url) {
  var s = String(url || '').trim();
  var m = s.match(/\/(?:s|pack)\/([A-Za-z0-9]{4,12})(?:[?#/]|$)/i);
  if (m) return m[1].toUpperCase();
  m = s.match(/^stickerly:\/\/[^/\s]*\/?([A-Za-z0-9]{4,12})(?:[?#]|$)/i);
  if (m) return m[1].toUpperCase();
  if (/^[A-Za-z0-9]{4,12}$/.test(s)) return s.toUpperCase();
  return null;
}

function stickerlyLooksLikeImage(buf) {
  if (buf.byteLength < 12) return false;
  var b = new Uint8Array(buf);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true;
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true;
  return false;
}

function stickerlyMime(fn) {
  if (/\.png$/i.test(fn)) return 'image/png';
  if (/\.gif$/i.test(fn)) return 'image/gif';
  if (/\.(jpg|jpeg)$/i.test(fn)) return 'image/jpeg';
  return 'image/webp';
}

function importStickerPackClient(url) {
  var packId = stickerlyPackId(url);
  if (!packId) return Promise.reject(new Error('Link de sticker.ly no reconocido'));

  return fetch('https://api.sticker.ly/v3.1/stickerPack/' + encodeURIComponent(packId), {
    headers: { 'Accept': 'application/json' }
  })
    .then(function (r) { if (!r.ok) throw new Error('El paquete no existe (' + r.status + ')'); return r.json(); })
    .then(function (data) {
      var res = data && data.result;
      if (!res || typeof res.resourceUrlPrefix !== 'string' || !Array.isArray(res.stickers) || !res.stickers.length) {
        throw new Error('El paquete no tiene stickers');
      }
      var name = typeof res.name === 'string' && res.name ? res.name : packId;
      var prefix = res.resourceUrlPrefix;
      var files = res.stickers.slice(0, 100);
      var ok = 0;
      var chain = Promise.resolve();
      files.forEach(function (s) {
        chain = chain.then(function () {
          if (!s || typeof s.fileName !== 'string') return;
          var fn = s.fileName;
          return fetch(prefix + fn)
            .then(function (rr) { if (!rr.ok) throw new Error('bad'); return rr.arrayBuffer(); })
            .then(function (buf) {
              if (!stickerlyLooksLikeImage(buf)) throw new Error('bad');
              return AC.supabase.storage.from('stickers').upload(AC.me.id + '/' + packId + '/' + fn, buf, {
                contentType: stickerlyMime(fn),
                cacheControl: '31536000',
                upsert: true
              });
            })
            .then(function (up) { if (!up.error) ok++; })
            .catch(function () {});
        });
      });
      return chain.then(function () {
        if (!ok) throw new Error('No se pudo descargar ningún sticker');
        return acRpc('set_sticker_pack', { p_pack_id: packId, p_name: name }).then(function () {
          return { name: name, pack_id: packId, count: ok };
        });
      });
    });
}

document.addEventListener('click', function (e) {
  if (stickerOpen && !e.target.closest('#stickerPanel') && !e.target.closest('.icon-btn-sticker')) {
    stickerOpen = false;
    var p = document.getElementById('stickerPanel');
    if (p) p.hidden = true;
  }
});
document.addEventListener('keydown', function (e) {
  if (stickerOpen && e.key === 'Enter' && e.target.id === 'stickerLink') {
    e.preventDefault();
    importStickerPack();
  }
});
