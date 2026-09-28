-- Retirer un message (suppression logique) et réagir avec un emoji.

-- Suppression logique : le contenu est effacé et deleted_at marque le message.
-- Les autres membres voient un message « supprimé » au lieu du contenu.
-- if not exists : le fichier est rejouable (l'aperçu Supabase rejoue les migrations).
alter table public.messages
    add column if not exists deleted_at timestamptz;

-- Une seule réaction par utilisateur et par message (la clé composite le garantit).
create table if not exists public.message_reactions (
    message_id uuid not null references public.messages (id) on delete cascade,
    user_id uuid not null references public.users (id) on delete cascade,
    emoji text not null check (char_length(emoji) between 1 and 8),
    created_at timestamptz not null default now(),
    primary key (message_id, user_id)
);

create index if not exists message_reactions_message_id_idx on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

-- Visible par les membres de la conversation du message.
drop policy if exists "message_reactions_select_member" on public.message_reactions;
create policy "message_reactions_select_member" on public.message_reactions
    for select to authenticated
    using (
        exists (
            select 1 from public.messages m
            where m.id = message_id
              and public.is_conversation_member(m.conversation_id)
        )
    );

-- Chacun pose sa propre réaction, dans une de ses conversations, sur un message non supprimé.
drop policy if exists "message_reactions_insert_own" on public.message_reactions;
create policy "message_reactions_insert_own" on public.message_reactions
    for insert to authenticated
    with check (
        (select auth.uid()) = user_id
        and exists (
            select 1 from public.messages m
            where m.id = message_id
              and m.deleted_at is null
              and public.is_conversation_member(m.conversation_id)
        )
    );

drop policy if exists "message_reactions_update_own" on public.message_reactions;
create policy "message_reactions_update_own" on public.message_reactions
    for update to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

-- Chacun retire sa réaction ; l'auteur du message peut aussi nettoyer celles des autres
-- quand il retire son message (utilisé par la RPC delete_message).
drop policy if exists "message_reactions_delete_own" on public.message_reactions;
create policy "message_reactions_delete_own" on public.message_reactions
    for delete to authenticated
    using (
        (select auth.uid()) = user_id
        or exists (
            select 1 from public.messages m
            where m.id = message_id
              and m.sender_id = (select auth.uid())
        )
    );

-- L'auteur du message peut supprimer les fichiers attachés (vocaux) de ses messages.
drop policy if exists "attachments_delete_sender" on public.attachments;
create policy "attachments_delete_sender" on public.attachments
    for delete to authenticated
    using (
        exists (
            select 1 from public.messages m
            where m.id = message_id
              and m.sender_id = (select auth.uid())
        )
    );

-- Retirer un message : efface le contenu, marque deleted_at, nettoie réactions et fichiers.
-- SECURITY INVOKER : la RLS limite chaque instruction aux messages de l'auteur.
create or replace function public.delete_message(msg_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if (select auth.uid()) is null then
        raise exception 'Authentification requise.';
    end if;
    update public.messages
       set content = '', deleted_at = now()
     where id = msg_id
       and sender_id = (select auth.uid())
       and deleted_at is null;
    delete from public.message_reactions where message_id = msg_id;
    delete from public.attachments where message_id = msg_id;
end;
$$;
revoke execute on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;

-- Data API : authenticated uniquement (RLS filtre les lignes), pas d'accès anon.
grant select, insert, update, delete on public.message_reactions to authenticated;
revoke all on public.message_reactions from anon;

-- Realtime : les réactions et les suppressions se propagent en direct.
-- Garde : add table échoue si la table est déjà membre de la publication.
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'message_reactions'
    ) then
        alter publication supabase_realtime add table public.message_reactions;
    end if;
end
$$;
