-- Visibilité des membres d'une conversation + realtime sur conversation_members

-- La fonction devient SECURITY DEFINER pour éviter la récursion RLS
-- (la politique de conversation_members s'appuie sur cette fonction).
-- Elle ne révèle que l'appartenance de l'utilisateur courant (auth.uid()).
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
          and cm.user_id = (select auth.uid())
    );
$$;

revoke execute on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;

drop policy if exists "members_select" on public.conversation_members;
create policy "members_select" on public.conversation_members
    for select to authenticated
    using ((select auth.uid()) = user_id or public.is_conversation_member(conversation_id));

alter publication supabase_realtime add table public.conversation_members;
