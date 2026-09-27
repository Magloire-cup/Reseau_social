-- Blocage de contact : un utilisateur peut bloquer un autre utilisateur.
-- Tant qu'un blocage existe entre deux membres d'une conversation, aucun
-- message ne peut y être envoyé (dans les deux sens).

create table public.blocks (
    blocker_id uuid not null references public.users (id) on delete cascade,
    blocked_id uuid not null references public.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker_id, blocked_id),
    check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

-- Chacun ne voit et ne gère que ses propres blocages.
create policy "blocks_select_own" on public.blocks
    for select to authenticated
    using ((select auth.uid()) = blocker_id);

create policy "blocks_insert_own" on public.blocks
    for insert to authenticated
    with check ((select auth.uid()) = blocker_id);

create policy "blocks_delete_own" on public.blocks
    for delete to authenticated
    using ((select auth.uid()) = blocker_id);

-- True si un blocage existe entre deux membres de la conversation.
-- SECURITY DEFINER : la politique RLS de messages l'appelle pour le compte
-- d'un expéditeur qui ne peut pas voir la ligne de blocage le concernant.
-- La garde d'appartenance limite l'information aux conversations de l'appelant.
create or replace function public.conversation_is_blocked(conv_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.is_conversation_member(conv_id)
       and exists (
            select 1
            from public.blocks b
            join public.conversation_members blocker
              on blocker.conversation_id = conv_id and blocker.user_id = b.blocker_id
            join public.conversation_members blocked
              on blocked.conversation_id = conv_id and blocked.user_id = b.blocked_id
       );
$$;

revoke execute on function public.conversation_is_blocked(uuid) from public, anon;
grant execute on function public.conversation_is_blocked(uuid) to authenticated;

-- Refuser l'envoi de messages dans une conversation bloquée.
drop policy if exists "messages_insert_member" on public.messages;
create policy "messages_insert_member" on public.messages
    for insert to authenticated
    with check (
        public.is_conversation_member(conversation_id)
        and (sender_id = (select auth.uid()) or sender_id is null)
        and not public.conversation_is_blocked(conversation_id)
    );

-- Data API : accès pour authenticated uniquement (RLS filtre les lignes).
grant select, insert, delete on public.blocks to authenticated;
revoke all on public.blocks from anon;
