// ═══════════════════════════════════════════════════════════════════
//  AeroChat · calls.js
//  ------------------------------------------------------------------
//  Llamadas WebRTC (malla P2P: audio/video, 1:1 y de grupo) usando
//  Supabase Realtime en lugar de SignalR:
//    · Inbox por usuario:  canal broadcast "call-inbox-{userId}"
//      (incoming_call, call_busy, call_declined, call_cancelled…)
//    · Sala por llamada:   canal "call-{roomId}"
//      · Presence  → lista de miembros (roster) del mesh
//      · Broadcast → señales WebRTC (offer/answer/candidate)
//  Reutiliza el algoritmo de negociación "perfect negotiation" del
//  proyecto original (polite/impolite).
//  ═══════════════════════════════════════════════════════════════════

var AC_RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};

window.acCall = {
  roomId: null, type: null, mode: null, myId: null, myName: '',
  groupCall: false, groupId: null, groupName: null, groupMembers: [],
  peerId: null, peerName: '', peerAvatar: '', peerColor: '#6C63FF',
  stream: null, muted: false, camOff: false,
  peers: {}, memberInfo: {},
  timerInt: null, startTs: 0,
  ringCtx: null, ringOsc: null, ringInt: null,
  outgoingTimer: null, incoming: null,
  roomCh: null
};

// ── Estado / UI ─────────────────────────────────────────────────────
function setCallUi(state) { var el = document.getElementById('callState'); if (el) el.textContent = state; }
function setCallTimer(show) { var el = document.getElementById('callTimer'); if (el) el.hidden = !show; }
function updateCallButtons() {
  var ov = document.getElementById('callOverlay');
  if (!ov) return;
  ov.classList.toggle('incoming', window.acCall.mode === 'incoming');
  ov.classList.toggle('active', window.acCall.mode === 'active');
  ov.classList.toggle('video', window.acCall.type === 'video');
}
function showCallOverlay() {
  var ov = document.getElementById('callOverlay');
  if (!ov) return;
  ov.hidden = false;
  requestAnimationFrame(function () { ov.classList.add('show'); });
}
function hideCallOverlay() {
  var ov = document.getElementById('callOverlay');
  if (!ov) return;
  ov.classList.remove('show');
  setTimeout(function () { if (!ov.classList.contains('show')) ov.hidden = true; }, 300);
}

function mediaErrorToast(err) {
  if (err && err.name === 'NotAllowedError') showToast('Micrófono/cámara no permitido.');
  else if (err && err.name === 'NotFoundError') showToast('No se encontró micrófono o cámara.');
  else showToast('No se pudo acceder a los dispositivos.');
}
function acquireMedia() {
  var wantsVideo = window.acCall.type === 'video';
  return navigator.mediaDevices.getUserMedia({ audio: true, video: wantsVideo })
    .catch(function (err) {
      if (wantsVideo && err && err.name !== 'NotAllowedError') {
        return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }
      throw err;
    });
}

// ── Señalización por canales ────────────────────────────────────────
function acInitCalls() {
  if (AC._callsInited) return;
  AC._callsInited = true;
  var myId = AC.authUser.id;
  var ch = AC.supabase.channel('call-inbox-' + myId);
  ch
    .on('broadcast', { event: 'incoming_call' }, function (e) { onIncomingCall(e.payload || {}); })
    .on('broadcast', { event: 'call_cancelled' }, function (e) { onCallCancelled(e.payload || {}); })
    .on('broadcast', { event: 'call_declined' }, function (e) { onCallDeclined(e.payload || {}); })
    .on('broadcast', { event: 'call_busy' }, function (e) { onCallBusy(e.payload || {}); })
    .on('broadcast', { event: 'call_offline' }, function (e) { onCallOffline(e.payload || {}); })
    .on('broadcast', { event: 'call_ended' }, function (e) { onCallEndedInbox(e.payload || {}); });
  ch.subscribe();
  AC.channels.push(ch);
}

function sendToInbox(userId, msg) {
  var ch = AC.supabase.channel('call-inbox-' + userId);
  ch.subscribe(function (status) {
    if (status === 'SUBSCRIBED') {
      ch.send({ type: 'broadcast', event: msg.type, payload: msg.payload }).finally(function () {
        AC.supabase.removeChannel(ch);
      });
    }
  });
}

function roomBroadcast(event, payload) {
  var ch = window.acCall.roomCh;
  if (!ch) return;
  ch.send({ type: 'broadcast', event: event, payload: payload });
}

// ── Sala de llamada ─────────────────────────────────────────────────
function subscribeRoom(roomId) {
  var old = window.acCall.roomCh;
  if (old) { try { AC.supabase.removeChannel(old); } catch (e) {} }
  var ch = AC.supabase.channel('call-' + roomId, {
    config: { presence: { key: window.acCall.myId + '-' + acRandomId() } }
  });
  window.acCall.roomCh = ch;
  ch
    .on('presence', { event: 'sync' }, function () { roomPresenceSync(ch); })
    .on('presence', { event: 'join' }, function () { roomPresenceSync(ch); })
    .on('presence', { event: 'leave' }, function (e) { roomUserLeft(ch, e.leftPresences); })
    .on('broadcast', { event: 'signal' }, function (e) {
      var p = e.payload || {};
      handleCallSignal(p.from, p.message);
    })
    .on('broadcast', { event: 'call_ended' }, function (e) {
      var p = e.payload || {};
      if (window.acCall.roomId && window.acCall.roomId === p.roomId) {
        var dur = callDurationText();
        cleanupCall();
        showToast('La llamada finalizó.' + dur);
      }
    });
  ch.subscribe(function (status) {
    if (status === 'SUBSCRIBED') {
      ch.track({
        user_id: window.acCall.myId,
        display_name: window.acCall.myName || '',
        avatar_color: window.acCall.peerColor || '#6C63FF'
      });
    }
  });
  AC.channels.push(ch);
}

function roomPresenceSync(ch) {
  var st = ch.presenceState() || {};
  var members = {};
  Object.keys(st).forEach(function (k) {
    var v = st[k];
    var arr = Array.isArray(v) ? v : [v];
    arr.forEach(function (s) {
      if (s && s.user_id) members[s.user_id] = { userId: s.user_id, display_name: s.display_name || '', avatar_color: s.avatar_color || '#6C63FF' };
    });
  });
  window.acCall.memberInfo = members;
  renderParticipants();
  var others = Object.keys(members).filter(function (id) { return id !== window.acCall.myId; });
  if (window.acCall.mode === 'outgoing' && others.length) activateCall();
  if (window.acCall.mode === 'joining') activateCall();
  others.forEach(function (id) { createPeer(id); makeOffer(id); });
}

function roomUserLeft(ch, leftPresences) {
  var left = (leftPresences || []).map(function (s) { return s && s.user_id; }).filter(Boolean);
  left.forEach(function (uid) {
    if (uid === window.acCall.myId) return;
    delete window.acCall.memberInfo[uid];
    renderParticipants();
    var peer = window.acCall.peers[uid];
    if (peer) { try { peer.pc.close(); } catch (e) {} }
    delete window.acCall.peers[uid];
    var t = document.getElementById('callTile_' + uid);
    if (t) t.remove();
    if (!window.acCall.groupCall && uid === window.acCall.peerId) {
      endCall('La otra persona terminó la llamada.');
      return;
    }
    if (Object.keys(window.acCall.peers).length === 0) {
      endCall(window.acCall.groupCall ? 'La llamada de grupo finalizó.' : 'La otra persona terminó la llamada.');
    }
  });
}

function activateCall() {
  if (window.acCall.mode === 'active') return;
  window.acCall.mode = 'active';
  updateCallButtons();
  setCallUi('En llamada');
  setCallTimer(true);
  startTimer();
  stopRingtone();
  if (window.acCall.outgoingTimer) { clearTimeout(window.acCall.outgoingTimer); window.acCall.outgoingTimer = null; }
}

// ── WebRTC mesh (perfect negotiation, igual que el original) ────────
function sendCallSignal(remoteId, msg) {
  if (!window.acCall.roomId || !remoteId) return;
  roomBroadcast('signal', { roomId: window.acCall.roomId, from: window.acCall.myId, message: msg });
}

function addLocalTracksToPeer(peer) {
  if (peer.tracksAdded || !window.acCall.stream) return;
  peer.tracksAdded = true;
  window.acCall.stream.getTracks().forEach(function (t) { peer.pc.addTrack(t, window.acCall.stream); });
}
function syncLocalTracks() {
  Object.keys(window.acCall.peers).forEach(function (id) { addLocalTracksToPeer(window.acCall.peers[id]); });
}

function createPeer(remoteId) {
  if (window.acCall.peers[remoteId]) return window.acCall.peers[remoteId];
  var peer = {
    polite: String(window.acCall.myId) < String(remoteId),
    makingOffer: false,
    tracksAdded: false,
    pc: new RTCPeerConnection(AC_RTC_CONFIG),
    queue: []
  };
  window.acCall.peers[remoteId] = peer;
  addLocalTracksToPeer(peer);
  var pc = peer.pc;
  pc.onicecandidate = function (ev) {
    if (!ev.candidate) return;
    sendCallSignal(remoteId, {
      type: 'candidate', candidate: ev.candidate.candidate,
      sdpMid: ev.candidate.sdpMid, sdpMLineIndex: ev.candidate.sdpMLineIndex
    });
  };
  pc.ontrack = function (ev) {
    if (!peer.remoteStream) peer.remoteStream = new MediaStream();
    var src = ev.streams && ev.streams[0];
    if (src) {
      src.getTracks().forEach(function (t) {
        if (peer.remoteStream.getTracks().indexOf(t) === -1) peer.remoteStream.addTrack(t);
      });
    } else if (peer.remoteStream.getTracks().indexOf(ev.track) === -1) {
      peer.remoteStream.addTrack(ev.track);
    }
    attachRemoteStream(remoteId, peer.remoteStream);
  };
  pc.onconnectionstatechange = function () {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      delete window.acCall.peers[remoteId];
      var t = document.getElementById('callTile_' + remoteId);
      if (t) t.remove();
    }
  };
  return peer;
}

function makeOffer(remoteId) {
  var peer = window.acCall.peers[remoteId];
  if (!peer || !peer.pc) return;
  peer.makingOffer = true;
  peer.pc.createOffer()
    .then(function (offer) { return peer.pc.setLocalDescription(offer); })
    .then(function () { sendCallSignal(remoteId, { type: 'offer', sdp: peer.pc.localDescription.sdp }); })
    .catch(function (e) { console.error('AeroChat: offer', e); })
    .finally(function () { peer.makingOffer = false; });
}

function flushPeerQueue(peer) {
  peer.queue.forEach(function (msg) {
    peer.pc.addIceCandidate(new RTCIceCandidate({
      candidate: msg.candidate, sdpMid: msg.sdpMid, sdpMLineIndex: msg.sdpMLineIndex
    })).catch(function (e) { console.error('AeroChat: ice flush', e); });
  });
  peer.queue = [];
}

function handleCallSignal(from, msg) {
  if (!msg || !msg.type || from === window.acCall.myId) return;
  var peer = createPeer(from);
  var pc = peer.pc;
  if (msg.type === 'offer') {
    var collision = peer.makingOffer || pc.signalingState !== 'stable';
    if (collision && !peer.polite) return;
    if (collision && pc.signalingState === 'have-local-offer') {
      pc.setLocalDescription({ type: 'rollback' });
    }
    pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: msg.sdp }))
      .then(function () { flushPeerQueue(peer); })
      .then(function () { return pc.createAnswer(); })
      .then(function (answer) { return pc.setLocalDescription(answer); })
      .then(function () { sendCallSignal(from, { type: 'answer', sdp: pc.localDescription.sdp }); })
      .catch(function (e) { console.error('AeroChat: answer', e); });
  } else if (msg.type === 'answer') {
    if (pc.signalingState === 'stable') return;
    pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }))
      .then(function () { flushPeerQueue(peer); })
      .catch(function (e) { console.error('AeroChat: setRemote answer', e); });
  } else if (msg.type === 'candidate' && msg.candidate) {
    if (!pc.remoteDescription) { peer.queue.push(msg); return; }
    pc.addIceCandidate(new RTCIceCandidate({
      candidate: msg.candidate, sdpMid: msg.sdpMid, sdpMLineIndex: msg.sdpMLineIndex
    })).catch(function (e) { console.error('AeroChat: ice', e); });
  }
}

// ── Ringtone / timer ────────────────────────────────────────────────
function startRingtone() {
  if (window.acCall.ringCtx) return;
  var ctx = new (window.AudioContext || window.webkitAudioContext)();
  window.acCall.ringCtx = ctx;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 620;
  gain.gain.value = 0.06;
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start();
  window.acCall.ringOsc = osc;
  var on = true;
  window.acCall.ringInt = setInterval(function () {
    on = !on;
    gain.gain.value = on ? 0.06 : 0;
  }, 350);
}
function stopRingtone() {
  if (window.acCall.ringInt) clearInterval(window.acCall.ringInt);
  if (window.acCall.ringOsc) { try { window.acCall.ringOsc.stop(); } catch (e) {} }
  if (window.acCall.ringCtx) { try { window.acCall.ringCtx.close(); } catch (e) {} }
  window.acCall.ringInt = null; window.acCall.ringOsc = null; window.acCall.ringCtx = null;
}

function startTimer() {
  window.acCall.startTs = Date.now();
  if (window.acCall.timerInt) clearInterval(window.acCall.timerInt);
  window.acCall.timerInt = setInterval(function () {
    var s = Math.floor((Date.now() - window.acCall.startTs) / 1000);
    var el = document.getElementById('callTimer');
    if (el) el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }, 1000);
}
function callDurationText() {
  var ts = window.acCall.startTs;
  if (!ts) return '';
  var s = Math.floor((Date.now() - ts) / 1000);
  if (s < 1) return '';
  return ' · ' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// ── Video tiles ─────────────────────────────────────────────────────
function clearCallVideos() {
  var grid = document.getElementById('callVideos');
  if (grid) grid.innerHTML = '';
}
function localTile() {
  var grid = document.getElementById('callVideos');
  if (!grid) return null;
  var t = grid.querySelector('.call-video-tile.local');
  if (t) return t;
  t = document.createElement('div');
  t.className = 'call-video-tile local';
  var v = document.createElement('video');
  v.autoplay = true; v.muted = true; v.playsInline = true;
  t.appendChild(v);
  grid.insertBefore(t, grid.firstChild);
  return t;
}
function renderPeerVideo(remoteId) {
  var grid = document.getElementById('callVideos');
  if (!grid) return null;
  var t = document.createElement('div');
  t.className = 'call-video-tile remote';
  t.id = 'callTile_' + remoteId;
  var v = document.createElement('video');
  v.autoplay = true; v.playsInline = true;
  t.appendChild(v);
  grid.appendChild(t);
  return t;
}
function attachLocalStream(stream) {
  if (window.acCall.type !== 'video' || !stream) return;
  var t = localTile();
  if (!t) return;
  var v = t.querySelector('video');
  v.srcObject = stream;
  v.play().catch(function (e) { console.error('AeroChat: play local', e); });
}
function attachRemoteStream(remoteId, stream) {
  if (!stream) return;
  var t = document.getElementById('callTile_' + remoteId);
  if (!t) t = renderPeerVideo(remoteId);
  if (!t) return;
  var v = t.querySelector('video');
  if (v.srcObject !== stream) v.srcObject = stream;
  var p = v.play();
  if (p && p.catch) p.catch(function (e) {
    if (e && e.name === 'NotAllowedError') {
      v.muted = true;
      v.play().catch(function () {});
      v.muted = false;
    } else {
      console.error('AeroChat: play remoto', e);
    }
  });
}
function clearParticipants() {
  var p = document.getElementById('callParticipants');
  if (p) p.innerHTML = '';
}
function renderParticipants() {
  var p = document.getElementById('callParticipants');
  if (!p) return;
  p.innerHTML = '';
  Object.keys(window.acCall.memberInfo).forEach(function (id) {
    var m = window.acCall.memberInfo[id];
    var el = document.createElement('span');
    el.className = 'participant-chip';
    el.title = m.display_name || '';
    el.textContent = m.display_name ? m.display_name.charAt(0).toUpperCase() : '?';
    p.appendChild(el);
  });
}

function setupCallDisplay(peerId, name, avatar, color, state, type) {
  window.acCall.myId = AC.authUser.id;
  window.acCall.myName = AC.me ? AC.me.display_name : '';
  window.acCall.peerId = peerId;
  window.acCall.peerName = name || '';
  window.acCall.peerAvatar = avatar || '';
  window.acCall.peerColor = color || '#6C63FF';
  window.acCall.type = type || 'audio';
  var av = document.getElementById('callAvatar');
  if (av) {
    av.style.background = window.acCall.peerColor;
    av.textContent = name ? name.charAt(0).toUpperCase() : '?';
  }
  var nm = document.getElementById('callName');
  if (nm) nm.textContent = name || '…';
  setCallUi(state);
  showCallOverlay();
  updateCallButtons();
}

function cleanupCall() {
  stopRingtone();
  if (window.acCall.timerInt) clearInterval(window.acCall.timerInt);
  window.acCall.timerInt = null;
  if (window.acCall.outgoingTimer) clearTimeout(window.acCall.outgoingTimer);
  window.acCall.outgoingTimer = null;
  Object.keys(window.acCall.peers).forEach(function (id) {
    try { window.acCall.peers[id].pc.close(); } catch (e) {}
  });
  window.acCall.peers = {};
  window.acCall.memberInfo = {};
  window.acCall.groupMembers = [];
  if (window.acCall.roomCh) { try { window.acCall.roomCh.presence.untrack(); } catch (e) {} try { AC.supabase.removeChannel(window.acCall.roomCh); } catch (e) {} }
  window.acCall.roomCh = null;
  if (window.acCall.stream) {
    window.acCall.stream.getTracks().forEach(function (t) { t.stop(); });
  }
  window.acCall.stream = null;
  window.acCall.mode = null;
  window.acCall.roomId = null;
  window.acCall.type = null;
  window.acCall.groupCall = false;
  window.acCall.groupId = null;
  window.acCall.groupName = null;
  window.acCall.peerId = null;
  window.acCall.peerName = '';
  window.acCall.muted = false;
  window.acCall.camOff = false;
  window.acCall.incoming = null;
  window.acCall.startTs = 0;
  var muteBtn = document.getElementById('callMute');
  if (muteBtn) { muteBtn.classList.remove('muted'); muteBtn.textContent = '🎙'; }
  var camBtn = document.getElementById('callCam');
  if (camBtn) { camBtn.classList.remove('off'); camBtn.textContent = '🎥'; }
  setCallTimer(false);
  clearCallVideos();
  clearParticipants();
  updateCallButtons();
  hideCallOverlay();
}

function endCall(reason) {
  if (window.acCall.roomId) {
    roomBroadcast('call_ended', { roomId: window.acCall.roomId });
  }
  var dur = callDurationText();
  cleanupCall();
  if (reason) showToast(reason + dur);
}

// ── Acciones del usuario ────────────────────────────────────────────
function hangupCall() {
  if (!window.acCall.mode) return;
  if (window.acCall.mode === 'incoming') { declineIncoming(); return; }
  if (window.acCall.roomId) {
    var dur = callDurationText();
    roomBroadcast('call_ended', { roomId: window.acCall.roomId });
    cleanupCall();
    showToast('Llamada finalizada.' + dur);
  } else {
    cleanupCall();
  }
}

function declineIncoming() {
  if (window.acCall.mode !== 'incoming') return;
  sendToInbox(window.acCall.peerId, { type: 'call_declined', payload: { roomId: window.acCall.roomId } });
  cleanupCall();
}

function toggleMute() {
  if (!window.acCall.stream) return;
  window.acCall.muted = !window.acCall.muted;
  window.acCall.stream.getAudioTracks().forEach(function (t) { t.enabled = !window.acCall.muted; });
  var btn = document.getElementById('callMute');
  if (btn) {
    btn.classList.toggle('muted', window.acCall.muted);
    btn.textContent = window.acCall.muted ? '🔇' : '🎙';
  }
}

function toggleCam() {
  if (window.acCall.type !== 'video' || !window.acCall.stream) return;
  window.acCall.camOff = !window.acCall.camOff;
  window.acCall.stream.getVideoTracks().forEach(function (t) { t.enabled = !window.acCall.camOff; });
  var btn = document.getElementById('callCam');
  if (btn) {
    btn.classList.toggle('off', window.acCall.camOff);
    btn.textContent = window.acCall.camOff ? '🚫' : '🎥';
  }
}

function callFriend(peerId, name, avatar, color, type) {
  if (window.acCall.mode) { showToast('Ya hay una llamada en curso.'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Llamadas requieren HTTPS o localhost.');
    return;
  }
  if (!AC.online[peerId]) { showToast('La persona no está en línea.'); return; }
  type = type || 'audio';
  var roomId = acRandomId();
  setupCallDisplay(peerId, name, avatar, color, 'Llamando…', type);
  window.acCall.mode = 'outgoing';
  window.acCall.roomId = roomId;
  updateCallButtons();
  subscribeRoom(roomId);
  window.acCall.outgoingTimer = setTimeout(function () {
    if (window.acCall.mode === 'outgoing') {
      sendToInbox(peerId, { type: 'call_cancelled', payload: { roomId: roomId } });
      endCall('La persona no respondió.');
    }
  }, 30000);
  acquireMedia()
    .then(function (stream) {
      window.acCall.stream = stream;
      attachLocalStream(stream);
      syncLocalTracks();
      sendToInbox(peerId, {
        type: 'incoming_call',
        payload: {
          fromId: window.acCall.myId,
          fromName: AC.me ? AC.me.display_name : '',
          fromAvatar: AC.me && AC.me.avatar_path ? AC.me.avatar_path : '',
          fromColor: AC.me && AC.me.avatar_color ? AC.me.avatar_color : '#6C63FF',
          roomId: roomId, type: type, groupId: null
        }
      });
    })
    .catch(function (err) {
      mediaErrorToast(err);
      cleanupCall();
    });
}

function callGroup(groupId, groupName, groupColor, type) {
  if (window.acCall.mode) { showToast('Ya hay una llamada en curso.'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Llamadas requieren HTTPS o localhost.');
    return;
  }
  type = type || 'audio';
  var roomId = acRandomId();
  setupCallDisplay(groupId, groupName, '', groupColor, 'Llamando…', type);
  window.acCall.groupCall = true;
  window.acCall.groupId = groupId;
  window.acCall.groupName = groupName || '';
  window.acCall.mode = 'outgoing';
  window.acCall.roomId = roomId;
  updateCallButtons();
  subscribeRoom(roomId);
  window.acCall.outgoingTimer = setTimeout(function () {
    if (window.acCall.mode === 'outgoing') {
      window.acCall.groupMembers.forEach(function (mid) {
        sendToInbox(mid, { type: 'call_cancelled', payload: { roomId: roomId } });
      });
      endCall('Nadie respondió.');
    }
  }, 60000);
  acquireMedia()
    .then(function (stream) {
      window.acCall.stream = stream;
      attachLocalStream(stream);
      syncLocalTracks();
      return acGetGroup(groupId).then(function (g) {
        var members = (g && g.member_ids || []).filter(function (id) { return id !== window.acCall.myId; });
        window.acCall.groupMembers = members;
        members.forEach(function (mid) {
          sendToInbox(mid, {
            type: 'incoming_call',
            payload: {
              fromId: window.acCall.myId,
              fromName: AC.me ? AC.me.display_name : '',
              fromAvatar: AC.me && AC.me.avatar_path ? AC.me.avatar_path : '',
              fromColor: AC.me && AC.me.avatar_color ? AC.me.avatar_color : '#6C63FF',
              roomId: roomId, type: type,
              groupId: groupId, groupName: groupName || '', groupColor: groupColor || '#6C63FF'
            }
          });
        });
      });
    })
    .catch(function (err) {
      mediaErrorToast(err);
      cleanupCall();
    });
}

function acceptIncoming() {
  if (window.acCall.mode !== 'incoming') return;
  window.acCall.mode = 'joining';
  updateCallButtons();
  setCallUi('Conectando…');
  subscribeRoom(window.acCall.roomId);
  acquireMedia()
    .then(function (stream) {
      window.acCall.stream = stream;
      attachLocalStream(stream);
      syncLocalTracks();
      // La presencia en la sala dispara el mesh (roomPresenceSync).
    })
    .catch(function (err) {
      mediaErrorToast(err);
      window.acCall.mode = 'incoming';
      updateCallButtons();
      setCallUi('Llamada entrante…');
    });
}

function openCallInvite() {
  var modal = document.getElementById('callInviteModal');
  var list = document.getElementById('callInviteList');
  if (!modal || !list) return;
  modal.hidden = false;
  list.innerHTML = 'Cargando amigos…';
  acGetFriends()
    .then(function (friends) {
      var inCall = Object.keys(window.acCall.peers);
      if (window.acCall.peerId) inCall.push(window.acCall.peerId);
      var eligible = (friends || []).filter(function (f) { return inCall.indexOf(f.id) < 0; });
      if (!eligible.length) {
        list.innerHTML = '<div class="sidebar-empty">No hay amigos para invitar.</div>';
        return;
      }
      list.innerHTML = eligible.map(function (f) {
        return '<div class="call-invite-item" onclick="sendCallInvite(\'' + f.id + '\')">' +
          '<span class="avatar-wrap">' + acAvatarHtml(f, 'avatar avatar-sm') + '</span>' +
          '<span class="group-pick-name">' + escapeHtml(f.display_name) + '</span>' +
          '<span class="call-invite-go">→</span>' +
          '</div>';
      }).join('');
    })
    .catch(function () {
      list.innerHTML = '<div class="sidebar-empty">No se pudieron cargar tus amigos.</div>';
    });
}

function sendCallInvite(friendId) {
  var modal = document.getElementById('callInviteModal');
  if (modal) modal.hidden = true;
  sendToInbox(friendId, {
    type: 'incoming_call',
    payload: {
      fromId: window.acCall.myId,
      fromName: AC.me ? AC.me.display_name : '',
      fromAvatar: AC.me && AC.me.avatar_path ? AC.me.avatar_path : '',
      fromColor: AC.me && AC.me.avatar_color ? AC.me.avatar_color : '#6C63FF',
      roomId: window.acCall.roomId,
      type: window.acCall.type,
      groupId: window.acCall.groupCall ? window.acCall.groupId : null,
      groupName: window.acCall.groupCall ? window.acCall.groupName : null
    }
  });
}

// ── Eventos de inbox ────────────────────────────────────────────────
function onIncomingCall(payload) {
  if (!payload || !payload.roomId) return;
  if (window.acCall.mode) {
    sendToInbox(payload.fromId, { type: 'call_busy', payload: { roomId: payload.roomId } });
    return;
  }
  window.acCall.myId = AC.authUser.id;
  window.acCall.myName = AC.me ? AC.me.display_name : '';
  window.acCall.roomId = payload.roomId;
  window.acCall.type = payload.type === 'video' ? 'video' : 'audio';
  window.acCall.groupCall = !!(payload.groupId);
  window.acCall.groupId = payload.groupId || null;
  window.acCall.groupName = payload.groupName || null;
  window.acCall.peerId = payload.fromId;
  window.acCall.peerName = payload.fromName || '';
  window.acCall.peerAvatar = payload.fromAvatar || '';
  window.acCall.peerColor = payload.fromColor || '#6C63FF';
  window.acCall.incoming = payload;
  setupCallDisplay(window.acCall.peerId, window.acCall.peerName, window.acCall.peerAvatar, window.acCall.peerColor, 'Llamada entrante…', window.acCall.type);
  if (window.acCall.groupCall) {
    var nm = document.getElementById('callName');
    if (nm) nm.textContent = window.acCall.groupName || 'Llamada de grupo';
  }
  window.acCall.mode = 'incoming';
  updateCallButtons();
  startRingtone();
  showToast((window.acCall.peerName || 'Alguien') + ' te está llamando.', 'info');
}

function onCallCancelled(p) {
  if (!window.acCall.roomId || window.acCall.roomId !== p.roomId) return;
  cleanupCall();
  showToast('Llamada cancelada.');
}

function onCallDeclined(p) {
  if (!window.acCall.roomId || window.acCall.roomId !== p.roomId) return;
  if (window.acCall.groupCall) {
    showToast('Un participante rechazó la llamada.');
  } else if (window.acCall.mode === 'outgoing') {
    endCall('Llamada rechazada.');
  }
}

function onCallBusy(p) {
  if (window.acCall.groupCall) { showToast('La persona está en otra llamada.'); return; }
  if (window.acCall.mode === 'outgoing' && window.acCall.roomId === p.roomId) {
    endCall('La persona está en otra llamada.');
  }
}

function onCallOffline(p) {
  if (window.acCall.groupCall) { showToast('La persona no está en línea.'); return; }
  if (window.acCall.mode === 'outgoing' && window.acCall.roomId === p.roomId) {
    endCall('La persona no está en línea.');
  }
}

function onCallEndedInbox(p) {
  if (!window.acCall.roomId || window.acCall.roomId !== p.roomId) return;
  var dur = callDurationText();
  cleanupCall();
  showToast('La llamada finalizó.' + dur);
}
