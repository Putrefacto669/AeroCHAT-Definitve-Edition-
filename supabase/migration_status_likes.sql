-- Migración: Estados con video + Me gusta (status_likes)
-- Ejecutar en Supabase → SQL Editor sobre una DB existente.

-- 1) Permitir type 'video' en statuses (idempotente).
alter table public.statuses drop constraint if exists statuses_type_check;
alter table public.statuses add constraint statuses_type_check check (type in ('text','image','video'));

-- 2) Tabla de me gusta (un like por usuario y estado).
create table if not exists public.status_likes (
  id           uuid primary key default gen_random_uuid(),
  status_id    uuid not null references public.statuses(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (status_id, user_id)
);

create index if not exists idx_status_likes_status on public.status_likes (status_id);

-- 3) RLS.
alter table public.status_likes enable row level security;

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

-- 4) Funciones actualizadas.
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

-- 5) Realtime: publicar status_likes (y asegurar statuses).
do $$
declare t text;
begin
  foreach t in array array['statuses','status_likes'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
