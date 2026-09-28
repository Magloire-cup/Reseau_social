-- Compatibilité Clerk (Third-Party Auth Supabase).
--
-- Contexte : l'authentification passe de Supabase Auth à Clerk. Les identifiants
-- Clerk sont des chaînes ("user_xxx"), pas des UUID : toutes les colonnes qui
-- portent un identifiant utilisateur passent donc de uuid à text.
--
-- Choix de conception :
--   * les politiques RLS comparent (select auth.jwt()->>'sub'). Pour un jeton Clerk
--     "sub" vaut "user_xxx" ; pour un jeton Supabase historique il vaut l'UUID de
--     l'utilisateur — les deux continuent donc de fonctionner (transition douce).
--   * auth.uid() n'est plus utilisable : il convertit "sub" en uuid, ce qui échoue
--     avec un identifiant Clerk.
--   * la clé étrangère public.users.id -> auth.users(id) est supprimée : les types
--     ne correspondent plus. Le trigger handle_new_user reste en place (avec un
--     cast new.id::text) pour d'éventuelles inscriptions Supabase résiduelles.
--   * le fichier est rejouable : drop ... if exists partout, et re-création
--     complète des politiques (ALTER COLUMN TYPE re-planifie mal les expressions
--     stockées, la réécriture est donc explicite).

-- 1. Contraintes étrangères ---------------------------------------------------
-- Les FK sont retirées avant de changer le type des colonnes ; elles sont
-- recréées à l'identique (mêmes actions ON DELETE) une fois les types alignés.
alter table public.messages drop constraint if exists messages_sender_id_fkey;
alter table public.blocks drop constraint if exists blocks_blocker_id_fkey;
alter table public.blocks drop constraint if exists blocks_blocked_id_fkey;
alter table public.calls drop constraint if exists calls_caller_id_fkey;
alter table public.conversation_members drop constraint if exists conversation_members_user_id_fkey;
alter table public.call_participants drop constraint if exists call_participants_user_id_fkey;
alter table public.message_reactions drop constraint if exists message_reactions_user_id_fkey;
alter table public.users drop constraint if exists users_id_fkey;

-- blocks_check compare blocker_id <> blocked_id : l'expression redevient valide
-- une fois les deux colonnes converties, elle est donc recréée en section 4.
alter table public.blocks drop constraint if exists blocks_check;

-- 2. Politiques dépendantes ---------------------------------------------------
-- Elles sont supprimées avant l'ALTER COLUMN TYPE et recréées en section 4.
drop policy if exists "users_insert_own" on public.users;
drop policy if exists "users_update_own" on public.users;
drop policy if exists "members_select" on public.conversation_members;
drop policy if exists "members_insert_authenticated" on public.conversation_members;
drop policy if exists "members_update_own" on public.conversation_members;
drop policy if exists "members_delete_own" on public.conversation_members;
drop policy if exists "messages_insert_member" on public.messages;
drop policy if exists "messages_update_sender" on public.messages;
drop policy if exists "messages_delete_sender" on public.messages;
drop policy if exists "blocks_select_own" on public.blocks;
drop policy if exists "blocks_insert_own" on public.blocks;
drop policy if exists "blocks_delete_own" on public.blocks;
drop policy if exists "calls_select_member" on public.calls;
drop policy if exists "calls_insert_caller" on public.calls;
drop policy if exists "calls_update_member" on public.calls;
drop policy if exists "call_participants_insert_caller" on public.call_participants;
drop policy if exists "call_participants_update_member" on public.call_participants;
drop policy if exists "message_reactions_insert_own" on public.message_reactions;
drop policy if exists "message_reactions_update_own" on public.message_reactions;
drop policy if exists "message_reactions_delete_own" on public.message_reactions;
drop policy if exists "attachments_delete_sender" on public.attachments;
drop policy if exists "avatars_insert_own" on storage.objects;
drop policy if exists "avatars_select_own" on storage.objects;
drop policy if exists "avatars_update_own" on storage.objects;
drop policy if exists "avatars_delete_own" on storage.objects;

-- 3. Types des colonnes -------------------------------------------------------
-- Les valeurs existantes (UUID sous forme de chaîne) sont conservées telles quelles.
alter table public.users alter column id type text using id::text;
alter table public.conversation_members alter column user_id type text using user_id::text;
alter table public.messages alter column sender_id type text using sender_id::text;
alter table public.blocks alter column blocker_id type text using blocker_id::text;
alter table public.blocks alter column blocked_id type text using blocked_id::text;
alter table public.calls alter column caller_id type text using caller_id::text;
alter table public.call_participants alter column user_id type text using user_id::text;
alter table public.message_reactions alter column user_id type text using user_id::text;

-- 4. Contraintes étrangères recréées -----------------------------------------
alter table public.conversation_members
    add constraint conversation_members_user_id_fkey
    foreign key (user_id) references public.users (id) on delete cascade;

alter table public.messages
    add constraint messages_sender_id_fkey
    foreign key (sender_id) references public.users (id) on delete set null;

alter table public.blocks
    add constraint blocks_blocker_id_fkey
    foreign key (blocker_id) references public.users (id) on delete cascade;

alter table public.blocks
    add constraint blocks_blocked_id_fkey
    foreign key (blocked_id) references public.users (id) on delete cascade;

alter table public.calls
    add constraint calls_caller_id_fkey
    foreign key (caller_id) references public.users (id) on delete cascade;

alter table public.call_participants
    add constraint call_participants_user_id_fkey
    foreign key (user_id) references public.users (id) on delete cascade;

alter table public.message_reactions
    add constraint message_reactions_user_id_fkey
    foreign key (user_id) references public.users (id) on delete cascade;

alter table public.blocks
    add constraint blocks_check check (blocker_id <> blocked_id);

-- 5. Politiques RLS recréées --------------------------------------------------
-- (select auth.jwt()->>'sub') remplace (select auth.uid()) : identifiant Clerk ou UUID.

create policy "users_insert_own" on public.users
    for insert to authenticated
    with check ((select auth.jwt()->>'sub') = id);

create policy "users_update_own" on public.users
    for update to authenticated
    using ((select auth.jwt()->>'sub') = id)
    with check ((select auth.jwt()->>'sub') = id);

create policy "members_select" on public.conversation_members
    for select to authenticated
    using ((select auth.jwt()->>'sub') = user_id or public.is_conversation_member(conversation_id));

create policy "members_insert_authenticated" on public.conversation_members
    for insert to authenticated
    with check ((select auth.jwt()->>'sub') = user_id or public.is_conversation_member(conversation_id));

create policy "members_update_own" on public.conversation_members
    for update to authenticated
    using ((select auth.jwt()->>'sub') = user_id)
    with check ((select auth.jwt()->>'sub') = user_id);

create policy "members_delete_own" on public.conversation_members
    for delete to authenticated
    using ((select auth.jwt()->>'sub') = user_id);

-- sender_id null autorisé pour les réponses de l'assistant IA (route /api/chat).
create policy "messages_insert_member" on public.messages
    for insert to authenticated
    with check (
        public.is_conversation_member(conversation_id)
        and (sender_id = (select auth.jwt()->>'sub') or sender_id is null)
        and not public.conversation_is_blocked(conversation_id)
    );

create policy "messages_update_sender" on public.messages
    for update to authenticated
    using ((select auth.jwt()->>'sub') = sender_id)
    with check ((select auth.jwt()->>'sub') = sender_id);

create policy "messages_delete_sender" on public.messages
    for delete to authenticated
    using ((select auth.jwt()->>'sub') = sender_id);

create policy "blocks_select_own" on public.blocks
    for select to authenticated
    using ((select auth.jwt()->>'sub') = blocker_id);

create policy "blocks_insert_own" on public.blocks
    for insert to authenticated
    with check ((select auth.jwt()->>'sub') = blocker_id);

create policy "blocks_delete_own" on public.blocks
    for delete to authenticated
    using ((select auth.jwt()->>'sub') = blocker_id);

create policy "calls_select_member" on public.calls
    for select to authenticated
    using (public.is_call_member(id) or caller_id = (select auth.jwt()->>'sub'));

create policy "calls_insert_caller" on public.calls
    for insert to authenticated
    with check (
        caller_id = (select auth.jwt()->>'sub')
        and public.is_conversation_member(conversation_id)
    );

create policy "calls_update_member" on public.calls
    for update to authenticated
    using (public.is_call_member(id) or caller_id = (select auth.jwt()->>'sub'))
    with check (public.is_call_member(id) or caller_id = (select auth.jwt()->>'sub'));

create policy "call_participants_insert_caller" on public.call_participants
    for insert to authenticated
    with check (
        exists (
            select 1 from public.calls c
            where c.id = call_id
              and c.caller_id = (select auth.jwt()->>'sub')
        )
    );

create policy "call_participants_update_member" on public.call_participants
    for update to authenticated
    using (
        (select auth.jwt()->>'sub') = user_id
        or exists (
            select 1 from public.calls c
            where c.id = call_id
              and c.caller_id = (select auth.jwt()->>'sub')
        )
    )
    with check (
        (select auth.jwt()->>'sub') = user_id
        or exists (
            select 1 from public.calls c
            where c.id = call_id
              and c.caller_id = (select auth.jwt()->>'sub')
        )
    );

create policy "message_reactions_insert_own" on public.message_reactions
    for insert to authenticated
    with check (
        (select auth.jwt()->>'sub') = user_id
        and exists (
            select 1 from public.messages m
            where m.id = message_id
              and m.deleted_at is null
              and public.is_conversation_member(m.conversation_id)
        )
    );

create policy "message_reactions_update_own" on public.message_reactions
    for update to authenticated
    using ((select auth.jwt()->>'sub') = user_id)
    with check ((select auth.jwt()->>'sub') = user_id);

create policy "message_reactions_delete_own" on public.message_reactions
    for delete to authenticated
    using (
        (select auth.jwt()->>'sub') = user_id
        or exists (
            select 1 from public.messages m
            where m.id = message_id
              and m.sender_id = (select auth.jwt()->>'sub')
        )
    );

create policy "attachments_delete_sender" on public.attachments
    for delete to authenticated
    using (
        exists (
            select 1 from public.messages m
            where m.id = message_id
              and m.sender_id = (select auth.jwt()->>'sub')
        )
    );

-- Storage : le dossier racine est l'identifiant utilisateur (UUID historique ou "user_xxx").
create policy "avatars_insert_own" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.jwt()->>'sub'));

create policy "avatars_select_own" on storage.objects
    for select to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.jwt()->>'sub'));

create policy "avatars_update_own" on storage.objects
    for update to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.jwt()->>'sub'))
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.jwt()->>'sub'));

create policy "avatars_delete_own" on storage.objects
    for delete to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.jwt()->>'sub'));

-- 6. Fonctions ----------------------------------------------------------------
-- Les privilèges EXECUTE sont conservés par CREATE OR REPLACE FUNCTION.

-- Profil créé automatiquement à l'inscription Supabase résiduelle (new.id est un uuid).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    base_username text;
begin
    base_username := split_part(new.email, '@', 1);
    insert into public.users (id, name, username)
    values (
        new.id::text,
        coalesce(new.raw_user_meta_data ->> 'name', base_username),
        base_username || '_' || substr(new.id::text, 1, 6)
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

create or replace function public.is_conversation_member(conv_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.conversation_members cm
        where cm.conversation_id = conv_id
          and cm.user_id = (select auth.jwt()->>'sub')
    );
$$;

create or replace function public.is_call_member(target_call_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.call_participants cp
        where cp.call_id = target_call_id
          and cp.user_id = (select auth.jwt()->>'sub')
    );
$$;

create or replace function public.mark_conversation_read(conv_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    marked integer;
begin
    if not public.is_conversation_member(conv_id) then
        raise exception 'not a member of this conversation' using errcode = '42501';
    end if;
    update public.messages
       set status = 'read'
     where conversation_id = conv_id
       and sender_id is not null
       and sender_id <> (select auth.jwt()->>'sub')
       and status <> 'read';
    get diagnostics marked = row_count;
    update public.conversation_members
       set last_read_at = now()
     where conversation_id = conv_id
       and user_id = (select auth.jwt()->>'sub');
    return marked;
end;
$$;

create or replace function public.delete_message(msg_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if (select auth.jwt()->>'sub') is null then
        raise exception 'Authentification requise.';
    end if;
    update public.messages
       set content = '', deleted_at = now()
     where id = msg_id
       and sender_id = (select auth.jwt()->>'sub')
       and deleted_at is null;
    delete from public.message_reactions where message_id = msg_id;
    delete from public.attachments where message_id = msg_id;
end;
$$;

create or replace function public.send_voice_message(
    conv_id uuid,
    storage_path text,
    mime_type text,
    size_bytes bigint,
    duration_seconds integer,
    message_id uuid default null,
    reply_to uuid default null
)
returns public.messages
language plpgsql
security invoker
set search_path = ''
as $$
declare
    created public.messages;
begin
    if (select auth.jwt()->>'sub') is null then
        raise exception 'Authentification requise.';
    end if;
    if reply_to is not null and not exists (
        select 1 from public.messages where id = reply_to and conversation_id = conv_id
    ) then
        raise exception 'Message cité introuvable.';
    end if;
    insert into public.messages (id, conversation_id, sender_id, content, type, status, reply_to_id)
    values (coalesce(message_id, gen_random_uuid()), conv_id, (select auth.jwt()->>'sub'), '', 'audio', 'sent', reply_to)
    returning * into created;
    insert into public.attachments (message_id, url, mime_type, size_bytes, duration_seconds)
    values (created.id, storage_path, mime_type, size_bytes, duration_seconds);
    return created;
end;
$$;
