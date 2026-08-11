// ═══════════════════════════════════════════════════════════════════
//  AeroChat · api.js
//  ------------------------------------------------------------------
//  Envoltorio de TODAS las RPCs del schema.sql. Cada función llama a
//  supabase.rpc(...) y devuelve el valor del RPC (o null si hubo error).
//  Los errores de red/permisos se muestran por consola y con toast.
//  ═══════════════════════════════════════════════════════════════════

function acRpc(name, params) {
  return AC.supabase.rpc(name, params || {}).then(function (r) {
    if (r.error) throw r.error;
    return r.data;
  });
}

// ── Auth (anónimas) ─────────────────────────────────────────────────
function acUsernameAvailable(username) { return acRpc('username_available', { p_username: username }); }
function acResolveEmail(username)      { return acRpc('resolve_auth_email', { p_username: username }); }
function acCreateProfile(username, displayName, email) {
  return acRpc('create_profile', { p_username: username, p_display_name: displayName, p_email: email });
}

// ── Perfil ──────────────────────────────────────────────────────────
function acUpdateProfile(displayName, status, youtubeUrl) {
  return acRpc('update_profile', { p_display_name: displayName, p_status: status, p_youtube_url: youtubeUrl });
}
function acSetAvatar(url) { return acRpc('set_avatar', { p_path: url }); }
function acSetBanner(url) { return acRpc('set_banner', { p_path: url }); }
function acGetProfile(id) { return acRpc('get_profile_data', { p_id: id }); }

// ── Amigos ──────────────────────────────────────────────────────────
function acSendFriendRequest(to) { return acRpc('send_friend_request', { p_to: to }); }
function acAcceptFriendRequest(requestId) { return acRpc('accept_friend_request', { p_request_id: requestId }); }
function acDeclineFriendRequest(requestId) { return acRpc('decline_friend_request', { p_request_id: requestId }); }
function acCancelFriendRequest(to) { return acRpc('cancel_friend_request', { p_to: to }); }
function acRemoveFriend(friend) { return acRpc('remove_friend', { p_friend: friend }); }
function acGetFriends() { return acRpc('get_friends'); }

// ── Sidebar ─────────────────────────────────────────────────────────
function acGetSidebar() { return acRpc('get_sidebar_data'); }

// ── Mensajes directos ───────────────────────────────────────────────
function acInsertDirectMessage(receiver, content, type, fileName, filePath, fileSize, replyToId) {
  return acRpc('insert_direct_message', {
    p_receiver: receiver, p_content: content, p_type: type || 'text',
    p_file_name: fileName || null, p_file_path: filePath || null,
    p_file_size: fileSize || null, p_reply_to: replyToId || null
  });
}
function acGetConversation(other) { return acRpc('get_conversation', { p_other: other }); }
function acSearchDirect(other, q) { return acRpc('search_direct', { p_other: other, p_query: q }); }

// ── Mensajes de grupo ───────────────────────────────────────────────
function acInsertGroupMessage(group, content, type, fileName, filePath, fileSize, replyToId) {
  return acRpc('insert_group_message', {
    p_group: group, p_content: content, p_type: type || 'text',
    p_file_name: fileName || null, p_file_path: filePath || null,
    p_file_size: fileSize || null, p_reply_to: replyToId || null
  });
}
function acGetGroupMessages(group) { return acRpc('get_group_messages', { p_group: group }); }
function acSearchGroup(group, q) { return acRpc('search_group', { p_group: group, p_query: q }); }

// ── Editar / borrar ─────────────────────────────────────────────────
function acEditMessage(id, content) { return acRpc('edit_message', { p_message: id, p_content: content }); }
function acDeleteMessage(id) { return acRpc('delete_message', { p_message: id }); }

// ── Reacciones ──────────────────────────────────────────────────────
function acToggleReaction(messageId, emoji) {
  return acRpc('toggle_reaction', { p_message: messageId, p_emoji: emoji });
}

// ── Lecturas / no leídos ────────────────────────────────────────────
function acMarkDirectRead(other) { return acRpc('mark_direct_read', { p_other: other }); }
function acMarkGroupRead(group) { return acRpc('mark_group_read', { p_group: group }); }
function acGetUnread() { return acRpc('get_unread_counts'); }

// ── Grupos (administración) ─────────────────────────────────────────
function acCreateGroup(name, memberIds) {
  return acRpc('create_group', { p_name: name, p_member_ids: memberIds || [] });
}
function acAddGroupMember(group, member) { return acRpc('add_group_member', { p_group: group, p_member: member }); }
function acRemoveGroupMember(group, member) { return acRpc('remove_group_member', { p_group: group, p_member: member }); }
function acRenameGroup(group, name) { return acRpc('rename_group', { p_group: group, p_name: name }); }
function acSetGroupAvatar(group, url) { return acRpc('set_group_avatar', { p_group: group, p_path: url }); }

// Datos de un grupo (SELECT directo: RLS permite solo a miembros)
function acGetGroup(groupId) {
  return AC.supabase.from('groups').select('*').eq('id', groupId).maybeSingle().then(function (r) {
    if (r.error) throw r.error;
    return r.data;
  });
}
function acGetMembers(memberIds) {
  if (!memberIds || !memberIds.length) return Promise.resolve([]);
  return AC.supabase.from('profiles')
    .select('id, display_name, avatar_color, avatar_path, status, username')
    .in('id', memberIds).then(function (r) {
      if (r.error) throw r.error;
      return r.data || [];
    });
}

// ── Estados ─────────────────────────────────────────────────────────
function acAddStatus(content, type, filePath, fileName) {
  return acRpc('add_status', {
    p_content: content || '', p_type: type || 'text',
    p_file_path: filePath || null, p_file_name: fileName || null
  });
}
function acDeleteStatus(id) { return acRpc('delete_status', { p_status: id }); }
function acGetVisibleStatuses() { return acRpc('get_visible_statuses'); }
function acToggleStatusLike(statusId) { return acRpc('toggle_status_like', { p_status: statusId }); }

// ── Stickers ────────────────────────────────────────────────────────
function acGetStickerPacks() { return acRpc('get_sticker_packs'); }
function acGetStickerFavorites() { return acRpc('get_sticker_favorites'); }
function acGetStickerUsage() { return acRpc('get_sticker_usage'); }
function acToggleStickerFavorite(path) { return acRpc('toggle_sticker_favorite', { p_path: path }); }
function acImportStickerPack(url) {
  return AC.supabase.functions.invoke('import-sticker', { body: { url: url } }).then(function (r) {
    if (r.error) {
      // Edge Function devolvió un error HTTP: intentamos leer su mensaje.
      var ctx = r.error.context;
      if (ctx && ctx.response && typeof ctx.response.json === 'function') {
        return ctx.response.json().then(function (d) {
          throw new Error((d && d.message) || 'Error al importar');
        });
      }
      throw new Error(r.error.message || 'Error al importar');
    }
    return r.data;
  });
}

// ── Storage: listar carpetas de stickers ────────────────────────────
function acListStickers(folderPath) {
  return AC.supabase.storage.from('stickers').list(folderPath, { limit: 100, sortBy: { column: 'name', order: 'asc' } })
    .then(function (r) {
      if (r.error) throw r.error;
      return r.data || [];
    });
}

// ── Errores con toast ───────────────────────────────────────────────
function acToastError(err, fallback) {
  console.error('AeroChat:', err);
  if (err && err.message) showToast(err.message, 'error');
  else if (fallback) showToast(fallback, 'error');
  return null;
}
