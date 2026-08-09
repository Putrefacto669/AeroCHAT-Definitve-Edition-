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
  if (stickerOpen && !stickerData) loadStickers();
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
  var html = '<button type="button" class="sticker-tab" data-tab="fav">★ Favoritos</button>' +
    '<button type="button" class="sticker-tab" data-tab="used">⚡ Usados</button>';
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
      '<button type="button" class="sticker-fav' + (s.fav ? ' on' : '') + '" onclick="event.stopPropagation();toggleFavorite(\'' + s.path + '\', this)">★</button>' +
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
  var old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  acImportStickerPack(url)
    .then(function (d) {
      showToast('Paquete importado: ' + d.name + ' (' + d.count + ' stickers)', 'success');
      stickerData = null;
      loadStickers();
      input.value = '';
    })
    .catch(function (err) {
      var msg = (err && err.message) || 'No se pudo importar';
      showToast('No se pudo importar: ' + msg, 'error');
    })
    .then(function () {
      if (btn) { btn.disabled = false; btn.textContent = old; }
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
