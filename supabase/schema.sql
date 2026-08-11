-- ═══════════════════════════════════════════════════════════════════
--  AeroChat · Supabase schema (PostgreSQL)
--  Migración completa de la versión ASP.NET Core a Supabase.
--
--  📌 CÓMO USARLO:
--    1. Creá un proyecto en https://supabase.com
--    2. En el dashboard → SQL Editor → New query
--    3. Pegá TODO este archivo y ejecutalo.
--    4. Desactivá la confirmación de email:
--         Authentication → Sign In / Up → "Confirm email" = OFF
--       (usamos emails sintéticos @aerochat.local y no queremos
--        confirmación por correo).
--    5. (Opcional) Status de 24h: activá "pg_cron" y creá el job
--       indicado al final del archivo.
--
--  ℹ️  Diseño:
--    · Toda la lógica de negocio vive en FUNCIONES (RPCs) con
--      SECURITY DEFINER: el cliente JS llama a supabase.rpc(...).
--    · RLS (Row Level Security) solo habilita SELECT de lo que al
--      usuario le corresponde; los INSERT/UPDATE/DELETE se hacen
--      por las funciones, que validan permisos en el servidor.
--    · El email sintético para auth es: {usuario}@aerochat.local
--      (Supabase Auth exige email; nosotros seguimos usando "usuario").
-- ═══════════════════════════════════════════════════════════════════

-- ── Extensiones ────────────────────────────────────────────────────
-- gen_random_uuid() viene incluido en PostgreSQL 13+ (Supabase ≥15).

-- ═══════════════════════════════════════════════════════════════════
--  1. TABLAS
-- ═══════════════════════════════════════════════════════════════════

-- 1.1 Perfiles: 1 fila por cuenta de auth.users
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  username          text not null unique,          -- nombre de usuario (minúsculas)
  email             text not null unique,          -- email sintético para auth
  display_name      text not null default '',
  avatar_color      text not null default '#6C63FF',
  avatar_path       text,                          -- URL pública (bucket avatars)
  banner_path       text,                          -- URL pública (bucket banners)
  status            text,                          -- texto corto de estado
  youtube_song_url  text,
  created_at        timestamptz not null default now()
);

-- 1.2 Solicitudes de amistad
create table if not exists public.friend_requests (
  id          uuid primary key default gen_random_uuid(),
  from_user   uuid not null references public.profiles(id) on delete cascade,
  to_user     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (from_user, to_user)
);

-- 1.3 Amistades (se guardan ambas direcciones para consultas simples)
create table if not exists public.friendships (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  friend_id   uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, friend_id)
);

-- 1.4 Grupos
create table if not exists public.groups (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  member_ids    uuid[] not null default '{}',
  avatar_path   text,
  description   text,
  created_at    timestamptz not null default now()
);

-- 1.5 Mensajes (scope = 'direct' | 'group')
--     receiver_id = id del usuario (direct) o id del grupo (group)
create table if not exists public.messages (
  id                 uuid primary key default gen_random_uuid(),
  scope              text not null check (scope in ('direct','group')),
  sender_id          uuid not null references public.profiles(id) on delete cascade,
  receiver_id        uuid not null,
  content            text not null default '',
  type               text not null default 'text'
                     check (type in ('text','image','audio','document','video','sticker')),
  file_name          text,
  file_path          text,
  file_size          bigint,
  created_at         timestamptz not null default now(),
  edited_at          timestamptz,
  is_deleted         boolean not null default false,
  reply_to_id        uuid,
  reply_to_content   text,
  reply_to_sender    text,
  read_by            uuid[] not null default '{}',
  sender_name        text,          -- snapshot al enviar (render rápido)
  sender_color       text           -- snapshot al enviar
);

-- 1.6 Reacciones
create table if not exists public.reactions (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  emoji        text not null,
  created_at   timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

-- Necesario para que Supabase Realtime entregue los datos COMPLETOS de la
-- fila borrada (DELETE) en reacciones; así el cliente actualiza el contador
-- del emoji sin volver a descargar la conversación.
alter table public.reactions replica identity full;

-- 1.7 Estados (expiran a las 24h)
create table if not exists public.statuses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  user_name    text not null default '',
  user_color   text not null default '#6C63FF',
  user_avatar  text,
  content      text not null default '',
  type         text not null default 'text',
  file_path    text,
  file_name    text,
  created_at   timestamptz not null default now()
);

-- 1.7b Permitir foto, video y texto en estados (idempotente para DBs existentes).
alter table public.statuses drop constraint if exists statuses_type_check;
alter table public.statuses add constraint statuses_type_check check (type in ('text','image','video'));

-- 1.7c Me gusta de estados (un like por usuario y estado).
create table if not exists public.status_likes (
  id           uuid primary key default gen_random_uuid(),
  status_id    uuid not null references public.statuses(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (status_id, user_id)
);

-- 1.8 Librería de stickers (metadata; los archivos viven en Storage)
create table if not exists public.sticker_packs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  pack_id      text not null,             -- id del paquete en sticker.ly
  name         text not null default '',
  imported_at  timestamptz not null default now(),
  unique (user_id, pack_id)
);

create table if not exists public.sticker_favorites (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  path         text not null,             -- URL pública del sticker
  created_at   timestamptz not null default now(),
  unique (user_id, path)
);

create table if not exists public.sticker_usage (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  path         text not null,
  count        int not null default 0,
  unique (user_id, path)
);

-- Índices para las consultas más comunes
create index if not exists idx_messages_direct    on public.messages (scope, receiver_id, sender_id, created_at);
create index if not exists idx_messages_group     on public.messages (scope, receiver_id, created_at);
create index if not exists idx_reactions_message  on public.reactions (message_id);
create index if not exists idx_requests_to        on public.friend_requests (to_user, from_user);
create index if not exists idx_friends_user       on public.friendships (user_id, friend_id);
create index if not exists idx_statuses_time      on public.statuses (user_id, created_at);
create index if not exists idx_status_likes_status on public.status_likes (status_id);

-- ═══════════════════════════════════════════════════════════════════
--  2. ROW LEVEL SECURITY
--  (Solo SELECT. Las escrituras se hacen vía funciones SECURITY DEFINER)
-- ═══════════════════════════════════════════════════════════════════

alter table public.profiles          enable row level security;
alter table public.friend_requests   enable row level security;
alter table public.friendships       enable row level security;
alter table public.groups            enable row level security;
alter table public.messages          enable row level security;
alter table public.reactions         enable row level security;
alter table public.statuses          enable row level security;
alter table public.status_likes      enable row level security;
alter table public.sticker_packs     enable row level security;
alter table public.sticker_favorites enable row level security;
alter table public.sticker_usage     enable row level security;

-- profiles: cualquier usuario autenticado puede ver los demás (como el
-- panel "Descubrir" original). Solo se edita vía funciones.
drop policy if exists "profiles_select_auth" on public.profiles;
create policy "profiles_select_auth" on public.profiles
  for select to authenticated using (true);

-- friend_requests: solo las propias.
drop policy if exists "requests_select_own" on public.friend_requests;
create policy "requests_select_own" on public.friend_requests
  for select to authenticated using (from_user = auth.uid() or to_user = auth.uid());

-- friendships: solo las propias.
drop policy if exists "friendships_select_own" on public.friendships;
create policy "friendships_select_own" on public.friendships
  for select to authenticated using (user_id = auth.uid() or friend_id = auth.uid());

-- groups: solo grupos de los que soy miembro.
drop policy if exists "groups_select_member" on public.groups;
create policy "groups_select_member" on public.groups
  for select to authenticated using (auth.uid() = any(member_ids));

-- messages: DMs en los que participo + mensajes de grupos a los que pertenezco.
drop policy if exists "messages_select_visible" on public.messages;
create policy "messages_select_visible" on public.messages
  for select to authenticated using (
    (scope = 'direct' and (sender_id = auth.uid() or receiver_id = auth.uid()))
    or
    (scope = 'group' and exists (
      select 1 from public.groups g where g.id = receiver_id and auth.uid() = any(g.member_ids)
    ))
  );

-- reactions: solo reacciones de mensajes visibles para mí.
drop policy if exists "reactions_select_visible" on public.reactions;
create policy "reactions_select_visible" on public.reactions
  for select to authenticated using (
    exists (
      select 1 from public.messages m
      where m.id = message_id
        and (
          (m.scope = 'direct' and (m.sender_id = auth.uid() or m.receiver_id = auth.uid()))
          or
          (m.scope = 'group' and exists (
            select 1 from public.groups g where g.id = m.receiver_id and auth.uid() = any(g.member_ids)
          ))
        )
    )
  );

-- statuses: propios + de amigos, siempre < 24h.
drop policy if exists "statuses_select_visible" on public.statuses;
create policy "statuses_select_visible" on public.statuses
  for select to authenticated using (
    created_at >= now() - interval '24 hours'
    and (
      user_id = auth.uid()
      or exists (
        select 1 from public.friendships f
        where (f.user_id = auth.uid() and f.friend_id = user_id)
           or (f.friend_id = auth.uid() and f.user_id = user_id)
      )
    )
  );

-- status_likes: visibles solo para quien puede ver el estado (autor + amigos, < 24h).
drop policy if exists "status_likes_select_visible" on public.status_likes;
create policy "status_likes_select_visible" on public.status_likes
  for select to authenticated using (
    exists (
      select 1 from public.statuses s
      where s.id = status_id
        and s.created_at >= now() - interval '24 hours'
        and (
          s.user_id = auth.uid()
          or exists (
            select 1 from public.friendships f
            where (f.user_id = auth.uid() and f.friend_id = s.user_id)
               or (f.friend_id = auth.uid() and f.user_id = s.user_id)
          )
        )
    )
  );

-- stickers: solo los propios.
drop policy if exists "stickers_select_own" on public.sticker_packs;
create policy "stickers_select_own" on public.sticker_packs
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "favs_select_own" on public.sticker_favorites;
create policy "favs_select_own" on public.sticker_favorites
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "usage_select_own" on public.sticker_usage;
create policy "usage_select_own" on public.sticker_usage
  for select to authenticated using (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════
--  3. HELPER: serializa un mensaje a JSON (con sus reacciones)
-- ═══════════════════════════════════════════════════════════════════
create or replace function public._message_json(m public.messages)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id',               m.id,
    'sender_id',        m.sender_id,
    'sender_name',      m.sender_name,
    'sender_color',     m.sender_color,
    'receiver_id',      m.receiver_id,
    'scope',            m.scope,
    'content',          m.content,
    'type',             m.type,
    'file_name',        m.file_name,
    'file_path',        m.file_path,
    'file_size',        m.file_size,
    'created_at',       m.created_at,
    'edited_at',        m.edited_at,
    'is_deleted',       m.is_deleted,
    'reply_to_id',      m.reply_to_id,
    'reply_to_content', m.reply_to_content,
    'reply_to_sender',  m.reply_to_sender,
    'read_by',          coalesce(m.read_by, '{}'::uuid[]),
    'reactions',        coalesce((
      select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'emoji', r.emoji) order by r.created_at)
      from public.reactions r where r.message_id = m.id
    ), '[]'::jsonb)
  );
$$;

-- ═══════════════════════════════════════════════════════════════════
--  4. FUNCIONES PÚBLICAS (RPCs) — llamadas desde el cliente JS
--     Por defecto se otorgan a "authenticated".
-- ═══════════════════════════════════════════════════════════════════

-- ── 4.1 Auth (anónimas) ────────────────────────────────────────────

-- ¿Está disponible el nombre de usuario?
create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select not exists (
    select 1 from public.profiles where lower(username) = lower(p_username)
  );
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- Resuelve el email sintético de un usuario para poder loguear con
-- usuario+contraseña (Supabase Auth usa email).
create or replace function public.resolve_auth_email(p_username text)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select email from public.profiles where lower(username) = lower(p_username) limit 1;
$$;
grant execute on function public.resolve_auth_email(text) to anon, authenticated;

-- Crea el perfil tras el signUp (email sintético ya reservado en auth).
create or replace function public.create_profile(
  p_username text, p_display_name text, p_email text
) returns boolean language plpgsql security definer
set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then return false; end if;
  if exists (select 1 from public.profiles where lower(username) = lower(p_username))
     and not exists (select 1 from public.profiles where id = me) then
    return false; -- usuario ya tomado por otra cuenta
  end if;
  insert into public.profiles (id, username, email, display_name, avatar_color)
  values (me, lower(p_username), lower(p_email),
          coalesce(nullif(p_display_name,''), p_username),
          '#' || lpad(to_hex(floor(random() * 16777215)::int), 6, '0'))
  on conflict (id) do update
    set username = excluded.username,
        email = excluded.email,
        display_name = excluded.display_name;
  return true;
end;
$$;
grant execute on function public.create_profile(text, text, text) to authenticated;

-- ── 4.2 Perfil ─────────────────────────────────────────────────────
create or replace function public.update_profile(
  p_display_name text, p_status text, p_youtube_url text
) returns boolean language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if nullif(p_display_name, '') is null then return false; end if;
  update public.profiles
    set display_name = trim(p_display_name),
        status = nullif(trim(coalesce(p_status,'')), ''),
        youtube_song_url = nullif(trim(coalesce(p_youtube_url,'')), '')
  where id = auth.uid();
  return found;
end;
$$;

create or replace function public.set_avatar(p_path text) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  update public.profiles set avatar_path = nullif(p_path, '') where id = auth.uid()
$$;

create or replace function public.set_banner(p_path text) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  update public.profiles set banner_path = nullif(p_path, '') where id = auth.uid()
$$;

-- ── 4.3 Amigos ─────────────────────────────────────────────────────
create or replace function public.send_friend_request(p_to uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then return 'unauth'; end if;
  if me = p_to then return 'self'; end if;
  if exists (select 1 from public.friendships
             where (user_id = me and friend_id = p_to) or (friend_id = me and user_id = p_to))
    then return 'friends'; end if;
  if exists (select 1 from public.friend_requests where from_user = me and to_user = p_to)
    then return 'pending'; end if;
  if exists (select 1 from public.friend_requests where from_user = p_to and to_user = me)
    then return 'incoming'; end if;
  insert into public.friend_requests (from_user, to_user) values (me, p_to);
  return 'sent';
end;
$$;

create or replace function public.accept_friend_request(p_request_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); r public.friend_requests; other uuid;
begin
  if me is null then return null; end if;
  select * into r from public.friend_requests where id = p_request_id and to_user = me;
  if not found then return null; end if;
  other := r.from_user;
  insert into public.friendships (user_id, friend_id) values (me, other), (other, me)
  on conflict do nothing;
  delete from public.friend_requests where id = p_request_id;
  return other;
end;
$$;

create or replace function public.decline_friend_request(p_request_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); r public.friend_requests;
begin
  if me is null then return null; end if;
  select * into r from public.friend_requests where id = p_request_id and to_user = me;
  if not found then return null; end if;
  delete from public.friend_requests where id = p_request_id;
  return r.from_user;
end;
$$;

create or replace function public.cancel_friend_request(p_to uuid) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  with del as (
    delete from public.friend_requests where from_user = auth.uid() and to_user = p_to
  ) select true;
$$;

create or replace function public.remove_friend(p_friend uuid) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  with del as (
    delete from public.friendships
    where (user_id = auth.uid() and friend_id = p_friend)
       or (friend_id = auth.uid() and user_id = p_friend)
  ) select true;
$$;

create or replace function public.get_friends() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'display_name', u.display_name,
      'avatar_color', u.avatar_color, 'avatar_path', u.avatar_path)
      order by u.display_name)
    from public.friendships f
    join public.profiles u on u.id = f.friend_id
    where f.user_id = me
  ), '[]'::jsonb);
end;
$$;

-- ── 4.4 Sidebar (todo en una llamada) ──────────────────────────────
create or replace function public.get_sidebar_data() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); me_row public.profiles;
begin
  if me is null then return null; end if;
  select * into me_row from public.profiles where id = me;
  return jsonb_build_object(
    'me', to_jsonb(me_row),
    'users', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', u.id, 'username', u.username, 'display_name', u.display_name,
          'avatar_color', u.avatar_color, 'avatar_path', u.avatar_path, 'status', u.status,
          'friend_state', case
            when exists (select 1 from public.friendships f
                         where (f.user_id = me and f.friend_id = u.id)
                            or (f.friend_id = me and f.user_id = u.id)) then 'friends'
            when exists (select 1 from public.friend_requests r
                         where r.from_user = me and r.to_user = u.id) then 'outgoing'
            when exists (select 1 from public.friend_requests r
                         where r.from_user = u.id and r.to_user = me) then 'incoming'
            else 'none' end,
          'request_id', (select r.id from public.friend_requests r
                         where r.from_user = u.id and r.to_user = me limit 1)
        ) order by u.display_name)
      from public.profiles u where u.id <> me
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', g.id, 'name', g.name, 'owner_id', g.owner_id,
          'member_ids', g.member_ids, 'avatar_path', g.avatar_path,
          'member_count', cardinality(g.member_ids))
        order by g.name)
      from public.groups g where me = any(g.member_ids)
    ), '[]'::jsonb),
    'unread', public.get_unread_counts()
  );
end;
$$;

-- ── 4.5 Mensajes directos ──────────────────────────────────────────
create or replace function public.insert_direct_message(
  p_receiver uuid, p_content text default '', p_type text default 'text',
  p_file_name text default null, p_file_path text default null, p_file_size bigint default null,
  p_reply_to uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); m public.messages;
begin
  if me is null then return null; end if;
  if p_type = 'text' and nullif(p_content, '') is null then return null; end if;
  if p_type <> 'text' and nullif(p_file_path, '') is null then return null; end if;
  if not exists (select 1 from public.profiles where id = p_receiver) then return null; end if;
  insert into public.messages
    (scope, sender_id, receiver_id, content, type, file_name, file_path, file_size,
     reply_to_id, reply_to_content, reply_to_sender, sender_name, sender_color)
  values
    ('direct', me, p_receiver, coalesce(p_content, ''), p_type, p_file_name, p_file_path, p_file_size,
     p_reply_to,
     (select content from public.messages where id = p_reply_to),
     (select sender_name from public.messages where id = p_reply_to),
     (select display_name from public.profiles where id = me),
     (select avatar_color from public.profiles where id = me))
  returning * into m;
  return public._message_json(m);
end;
$$;

create or replace function public.get_conversation(p_other uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(public._message_json(m) order by m.created_at)
    from public.messages m
    where m.scope = 'direct' and not m.is_deleted
      and ((m.sender_id = me and m.receiver_id = p_other)
        or (m.sender_id = p_other and m.receiver_id = me))
  ), '[]'::jsonb);
end;
$$;

create or replace function public.search_direct(p_other uuid, p_query text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null or nullif(p_query, '') is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(public._message_json(m) order by m.created_at desc)
    from public.messages m
    where m.scope = 'direct' and not m.is_deleted
      and ((m.sender_id = me and m.receiver_id = p_other)
        or (m.sender_id = p_other and m.receiver_id = me))
      and position(lower(p_query) in lower(m.content)) > 0
    limit 30
  ), '[]'::jsonb);
end;
$$;

-- ── 4.6 Mensajes de grupo ──────────────────────────────────────────
create or replace function public.insert_group_message(
  p_group uuid, p_content text default '', p_type text default 'text',
  p_file_name text default null, p_file_path text default null, p_file_size bigint default null,
  p_reply_to uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); m public.messages;
begin
  if me is null then return null; end if;
  if not exists (select 1 from public.groups g where g.id = p_group and me = any(g.member_ids))
    then return null; end if;
  if p_type = 'text' and nullif(p_content, '') is null then return null; end if;
  if p_type <> 'text' and nullif(p_file_path, '') is null then return null; end if;
  insert into public.messages
    (scope, sender_id, receiver_id, content, type, file_name, file_path, file_size,
     reply_to_id, reply_to_content, reply_to_sender, sender_name, sender_color)
  values
    ('group', me, p_group, coalesce(p_content, ''), p_type, p_file_name, p_file_path, p_file_size,
     p_reply_to,
     (select content from public.messages where id = p_reply_to),
     (select sender_name from public.messages where id = p_reply_to),
     (select display_name from public.profiles where id = me),
     (select avatar_color from public.profiles where id = me))
  returning * into m;
  return public._message_json(m);
end;
$$;

create or replace function public.get_group_messages(p_group uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then return '[]'::jsonb; end if;
  if not exists (select 1 from public.groups g where g.id = p_group and me = any(g.member_ids))
    then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(public._message_json(m) order by m.created_at)
    from public.messages m
    where m.scope = 'group' and m.receiver_id = p_group and not m.is_deleted
  ), '[]'::jsonb);
end;
$$;

create or replace function public.search_group(p_group uuid, p_query text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null or nullif(p_query, '') is null then return '[]'::jsonb; end if;
  if not exists (select 1 from public.groups g where g.id = p_group and me = any(g.member_ids))
    then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(public._message_json(m) order by m.created_at desc)
    from public.messages m
    where m.scope = 'group' and m.receiver_id = p_group and not m.is_deleted
      and position(lower(p_query) in lower(m.content)) > 0
    limit 30
  ), '[]'::jsonb);
end;
$$;

-- ── 4.7 Editar / borrar mensajes (soft-delete) ─────────────────────
create or replace function public.edit_message(p_message uuid, p_content text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); m public.messages;
begin
  if me is null or nullif(p_content, '') is null then return null; end if;
  update public.messages
    set content = trim(p_content), edited_at = now()
  where id = p_message and sender_id = me and type = 'text' and not is_deleted
  returning * into m;
  if not found then return null; end if;
  return public._message_json(m);
end;
$$;

create or replace function public.delete_message(p_message uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); m public.messages;
begin
  if me is null then return null; end if;
  update public.messages
    set is_deleted = true, content = 'Mensaje eliminado'
  where id = p_message and sender_id = me and not is_deleted
  returning * into m;
  if not found then return null; end if;
  return public._message_json(m);
end;
$$;

-- ── 4.8 Reacciones ─────────────────────────────────────────────────
create or replace function public.toggle_reaction(p_message uuid, p_emoji text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); mid uuid; added boolean; cnt int;
begin
  if me is null or nullif(p_emoji, '') is null then return null; end if;
  select m.id into mid from public.messages m
  where m.id = p_message and not m.is_deleted
    and (
      (m.scope = 'direct' and (m.sender_id = me or m.receiver_id = me))
      or
      (m.scope = 'group' and exists (
        select 1 from public.groups g where g.id = m.receiver_id and me = any(g.member_ids)
      ))
    );
  if mid is null then return null; end if;

  if exists (select 1 from public.reactions where message_id = mid and user_id = me and emoji = p_emoji) then
    delete from public.reactions where message_id = mid and user_id = me and emoji = p_emoji;
    added := false;
  else
    insert into public.reactions (message_id, user_id, emoji) values (mid, me, p_emoji);
    added := true;
  end if;

  select count(*) into cnt from public.reactions where message_id = mid and emoji = p_emoji;
  return jsonb_build_object('message_id', mid, 'emoji', p_emoji, 'added', added, 'count', cnt);
end;
$$;

-- ── 4.9 Lecturas / no leídos ───────────────────────────────────────
create or replace function public.mark_direct_read(p_other uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then return 0; end if;
  update public.messages
    set read_by = (select array_agg(distinct x) from unnest(coalesce(read_by, '{}'::uuid[]) || array[me]) x)
  where scope = 'direct' and sender_id = p_other and receiver_id = me
    and not is_deleted and not (me = any(coalesce(read_by, '{}'::uuid[])));
  return coalesce((select count(*) from (
    select 1 from public.messages
    where scope = 'direct' and sender_id = p_other and receiver_id = me
      and not is_deleted and not (me = any(coalesce(read_by, '{}'::uuid[])))
  ) t), 0)::int;
end;
$$;

create or replace function public.mark_group_read(p_group uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then return 0; end if;
  if not exists (select 1 from public.groups g where g.id = p_group and me = any(g.member_ids))
    then return 0; end if;
  update public.messages
    set read_by = (select array_agg(distinct x) from unnest(coalesce(read_by, '{}'::uuid[]) || array[me]) x)
  where scope = 'group' and receiver_id = p_group and sender_id <> me
    and not is_deleted and not (me = any(coalesce(read_by, '{}'::uuid[])));
  return 0; -- el cliente recalcula no leídos con get_unread_counts()
end;
$$;

create or replace function public.get_unread_counts() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then return '{}'::jsonb; end if;
  return coalesce((
    select jsonb_object_agg(t.key, t.cnt) from (
      select case when scope = 'direct' then sender_id::text else receiver_id::text end as key,
             count(*) as cnt
      from public.messages m
      where not is_deleted and not (me = any(coalesce(read_by, '{}'::uuid[])))
        and (
          (scope = 'direct' and receiver_id = me and sender_id <> me)
          or
          (scope = 'group' and sender_id <> me and exists (
            select 1 from public.groups g where g.id = m.receiver_id and me = any(g.member_ids)
          ))
        )
      group by key
    ) t
  ), '{}'::jsonb);
end;
$$;

-- ── 4.10 Grupos (administración) ───────────────────────────────────
create or replace function public.create_group(p_name text, p_member_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); g public.groups; members uuid[];
begin
  if me is null or nullif(p_name, '') is null then return null; end if;
  members := array(select distinct unnest(coalesce(p_member_ids, '{}'::uuid[]))
                   where unnest is not null
                     and exists (select 1 from public.profiles p where p.id = unnest));
  if not (me = any(members)) then members := members || me; end if;
  insert into public.groups (name, owner_id, member_ids)
  values (trim(p_name), me, members) returning * into g;
  return to_jsonb(g);
end;
$$;

create or replace function public.add_group_member(p_group uuid, p_member uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null or p_member is null then return false; end if;
  if not exists (select 1 from public.groups where id = p_group and owner_id = me) then return false; end if;
  if not exists (select 1 from public.profiles where id = p_member) then return false; end if;
  update public.groups
    set member_ids = array_remove(member_ids, p_member) || p_member
  where id = p_group and not (p_member = any(member_ids));
  return found;
end;
$$;

create or replace function public.remove_group_member(p_group uuid, p_member uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null or p_member is null then return false; end if;
  -- el dueño quita a cualquiera; un miembro se quita a sí mismo
  if not exists (
    select 1 from public.groups g
    where g.id = p_group and me = any(g.member_ids)
      and (g.owner_id = me or p_member = me)
  ) then return false; end if;
  update public.groups set member_ids = array_remove(member_ids, p_member)
  where id = p_group and p_member = any(member_ids);
  if found then
    -- si no quedan miembros, el grupo se elimina
    delete from public.groups
    where id = p_group and cardinality(member_ids) = 0;
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.rename_group(p_group uuid, p_name text) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  update public.groups set name = trim(p_name)
  where id = p_group and owner_id = auth.uid() and nullif(p_name, '') is not null
$$;

create or replace function public.set_group_avatar(p_group uuid, p_path text) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  update public.groups set avatar_path = nullif(p_path, '')
  where id = p_group and owner_id = auth.uid()
$$;

-- ── 4.11 Estados ───────────────────────────────────────────────────
create or replace function public.add_status(
  p_content text, p_type text default 'text',
  p_file_path text default null, p_file_name text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); s public.statuses;
begin
  if me is null then return null; end if;
  if p_type in ('image','video') and nullif(p_file_path, '') is null then return null; end if;
  if p_type = 'text' and nullif(p_content, '') is null then return null; end if;
  insert into public.statuses (user_id, user_name, user_color, user_avatar, content, type, file_path, file_name)
  values (me,
          (select display_name from public.profiles where id = me),
          (select avatar_color from public.profiles where id = me),
          (select avatar_path from public.profiles where id = me),
          coalesce(p_content, ''), p_type, p_file_path, p_file_name)
  returning * into s;
  return to_jsonb(s);
end;
$$;

create or replace function public.delete_status(p_status uuid) returns boolean
language sql security definer set search_path = public, pg_temp as $$
  delete from public.statuses where id = p_status and user_id = auth.uid()
$$;

create or replace function public.get_visible_statuses() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'user_id', s.user_id,
        'user_name', s.user_name,
        'user_color', s.user_color,
        'user_avatar', s.user_avatar,
        'content', s.content,
        'type', s.type,
        'file_path', s.file_path,
        'file_name', s.file_name,
        'created_at', s.created_at,
        'likes_count', (select count(*) from public.status_likes sl where sl.status_id = s.id),
        'liked_by_me', exists (select 1 from public.status_likes sl2 where sl2.status_id = s.id and sl2.user_id = me)
      ) order by s.user_id, s.created_at
    )
    from public.statuses s
    where s.created_at >= now() - interval '24 hours'
      and (
        s.user_id = me
        or exists (
          select 1 from public.friendships f
          where (f.user_id = me and f.friend_id = s.user_id)
             or (f.friend_id = me and f.user_id = s.user_id)
        )
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.toggle_status_like(p_status uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); liked boolean; cnt int;
begin
  if me is null then return null; end if;
  if not exists (
    select 1 from public.statuses s
    where s.id = p_status
      and s.created_at >= now() - interval '24 hours'
      and (
        s.user_id = me
        or exists (
          select 1 from public.friendships f
          where (f.user_id = me and f.friend_id = s.user_id)
             or (f.friend_id = me and f.user_id = s.user_id)
        )
      )
  ) then return null; end if;
  if exists (select 1 from public.status_likes where status_id = p_status and user_id = me) then
    delete from public.status_likes where status_id = p_status and user_id = me;
    liked := false;
  else
    insert into public.status_likes (status_id, user_id) values (p_status, me);
    liked := true;
  end if;
  select count(*) into cnt from public.status_likes where status_id = p_status;
  return jsonb_build_object('status_id', p_status, 'liked', liked, 'count', cnt);
end;
$$;

create or replace function public.cleanup_expired_statuses() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare removed int;
begin
  delete from public.statuses where created_at < now() - interval '24 hours';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- ── 4.12 Stickers ──────────────────────────────────────────────────
create or replace function public.toggle_sticker_favorite(p_path text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null or nullif(p_path, '') is null then return false; end if;
  if exists (select 1 from public.sticker_favorites where user_id = me and path = p_path) then
    delete from public.sticker_favorites where user_id = me and path = p_path;
    return false;
  end if;
  insert into public.sticker_favorites (user_id, path) values (me, p_path);
  return true;
end;
$$;

create or replace function public.record_sticker_use(p_path text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null or nullif(p_path, '') is null then return; end if;
  insert into public.sticker_usage (user_id, path, count) values (me, p_path, 1)
  on conflict (user_id, path) do update set count = public.sticker_usage.count + 1;
end;
$$;

create or replace function public.set_sticker_pack(p_pack_id text, p_name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null or nullif(p_pack_id, '') is null then return; end if;
  insert into public.sticker_packs (user_id, pack_id, name)
  values (me, p_pack_id, coalesce(nullif(p_name, ''), p_pack_id))
  on conflict (user_id, pack_id) do update set name = excluded.name;
end;
$$;

create or replace function public.get_sticker_packs() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('pack_id', pack_id, 'name', name) order by name)
    from public.sticker_packs where user_id = me
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_sticker_favorites() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(path) from public.sticker_favorites where user_id = me
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_sticker_usage() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid();
begin
  if me is null then return '{}'::jsonb; end if;
  return coalesce((
    select jsonb_object_agg(path, count) from public.sticker_usage where user_id = me
  ), '{}'::jsonb);
end;
$$;

-- ── 4.13 Perfil de otro usuario ────────────────────────────────────
create or replace function public.get_profile_data(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); pr public.profiles;
begin
  if me is null then return null; end if;
  select * into pr from public.profiles where id = p_id;
  if pr.id is null then return null; end if;
  return jsonb_build_object(
    'profile', to_jsonb(pr),
    'friend_state', case
      when exists (select 1 from public.friendships f
                   where (f.user_id = me and f.friend_id = p_id)
                      or (f.friend_id = me and f.user_id = p_id)) then 'friends'
      when exists (select 1 from public.friend_requests r where r.from_user = me and r.to_user = p_id) then 'outgoing'
      when exists (select 1 from public.friend_requests r where r.from_user = p_id and r.to_user = me) then 'incoming'
      else 'none' end,
    'request_id', (select r.id from public.friend_requests r
                   where r.from_user = p_id and r.to_user = me limit 1),
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id, 'display_name', u.display_name, 'avatar_color', u.avatar_color,
        'avatar_path', u.avatar_path)
        order by u.display_name)
      from public.friendships f
      join public.profiles u on u.id = f.friend_id
      where f.user_id = p_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
--  5. REAL-TIME
--  Habilitamos la publicación para que Supabase Realtime entregue
--  los cambios. RLS filtra qué filas ve cada suscriptor.
-- ═══════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['messages','reactions','friend_requests','friendships','groups','statuses','status_likes','profiles'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════
--  6. STORAGE (buckets + políticas)
--  Todos los buckets son públicos para leer; cada usuario solo puede
--  subir/borrar dentro de su propia carpeta (foldername[1] = user id).
-- ═══════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true),
       ('banners', 'banners', true),
       ('statuses', 'statuses', true),
       ('messages', 'messages', true),
       ('groups', 'groups', true),
       ('stickers', 'stickers', true)
on conflict (id) do nothing;

-- Lectura pública en todos los buckets de la app.
drop policy if exists "aerochat_public_read" on storage.objects;
create policy "aerochat_public_read" on storage.objects
  for select using (bucket_id in ('avatars','banners','statuses','messages','groups','stickers'));

-- Escritura: solo dentro de la carpeta propia (primera parte de la ruta = mi id).
drop policy if exists "aerochat_own_upload" on storage.objects;
create policy "aerochat_own_upload" on storage.objects
  for insert to authenticated with check (
    bucket_id in ('avatars','banners','statuses','messages','groups','stickers')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "aerochat_own_update" on storage.objects;
create policy "aerochat_own_update" on storage.objects
  for update to authenticated using (
    bucket_id in ('avatars','banners','statuses','messages','groups','stickers')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "aerochat_own_delete" on storage.objects;
create policy "aerochat_own_delete" on storage.objects
  for delete to authenticated using (
    bucket_id in ('avatars','banners','statuses','messages','groups','stickers')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ═══════════════════════════════════════════════════════════════════
--  7. OPCIONAL: LIMPIEZA AUTOMÁTICA DE ESTADOS (pg_cron)
--  Si activás la extensión pg_cron en el dashboard, podés correr este
--  bloque para que los estados >24h se borren solos cada 30 min.
-- ═══════════════════════════════════════════════════════════════════
-- select cron.schedule('cleanup-statuses', '*/30 * * * *', $$ select public.cleanup_expired_statuses() $$);
