// ═══════════════════════════════════════════════════════════════════
//  AeroChat · gifs.js
//  Picker de GIFs con búsqueda (GIPHY). El key se configura en
//  config.js como AC.gifKey; usa el beta key público si no se define.
//  ═══════════════════════════════════════════════════════════════════

var AC_GIF_KEY = (typeof AEROCHAT_GIPHY_KEY !== 'undefined' && AEROCHAT_GIPHY_KEY) ? AEROCHAT_GIPHY_KEY : 'dc6zaTOxFJmzC';

function toggleGifs() {
  var panel = document.getElementById('gifPanel');
  var btn = document.getElementById('gifBtn');
  if (!panel) return;
  var willOpen = panel.hidden;
  panel.hidden = !willOpen;
  if (btn) btn.classList.toggle('active', willOpen);
  if (!willOpen) return;
  var stickerPanel = document.getElementById('stickerPanel');
  if (stickerPanel) { stickerPanel.hidden = true; stickerPanel.classList.remove('open'); }
  var stBtn = document.querySelector('.icon-btn-sticker');
  if (stBtn) stBtn.classList.remove('active');
  var attachPanel = document.getElementById('attachPanel');
  if (attachPanel) attachPanel.classList.remove('open');
  acGifLoad('');
  var inp = document.getElementById('gifSearch');
  if (inp) inp.focus();
}

function gifSearchNow() {
  var inp = document.getElementById('gifSearch');
  acGifLoad(inp ? inp.value.trim() : '');
}

function acGifLoad(q) {
  var grid = document.getElementById('gifResults');
  if (!grid) return;
  grid.innerHTML = '<div class="sticker-empty">Cargando…</div>';
  var base = q
    ? 'https://api.giphy.com/v1/gifs/search?q=' + encodeURIComponent(q)
    : 'https://api.giphy.com/v1/gifs/trending';
  fetch(base + '&api_key=' + encodeURIComponent(AC_GIF_KEY) + '&limit=24&rating=g&lang=es')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.data || !d.data.length) {
        grid.innerHTML = '<div class="sticker-empty">Sin resultados</div>';
        return;
      }
      var html = '';
      d.data.forEach(function (g) {
        var im = g.images && (g.images.fixed_width_small || g.images.fixed_width || g.images.preview_gif);
        if (!im || !im.url) return;
        html += '<button class="gif-cell" title="Enviar" onclick="acSendGif(\'' + g.id + '\')"><img src="' + im.url + '" alt="GIF" loading="lazy"/></button>';
      });
      grid.innerHTML = html || '<div class="sticker-empty">Sin resultados</div>';
    })
    .catch(function () {
      grid.innerHTML = '<div class="sticker-empty">No se pudieron cargar los GIFs. Revisá tu conexión.</div>';
    });
}

function acSendGif(gifId) {
  var url = 'https://media.giphy.com/media/' + encodeURIComponent(gifId) + '/giphy.gif';
  acSendMessageContent('image', '', url, 'GIF.gif', null, AC.replyTo ? AC.replyTo.id : null);
  var panel = document.getElementById('gifPanel');
  if (panel) panel.hidden = true;
  var btn = document.getElementById('gifBtn');
  if (btn) btn.classList.remove('active');
}

(function () {
  var inp = document.getElementById('gifSearch');
  if (inp) inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); gifSearchNow(); }
  });
})();
