-- Profils étendus (bio déjà en place via users.status), présence détaillée et accusés de lecture

-- Dernière activité, pour « vu il y a … »
alter table public.users add column if not exists last_seen timestamptz;

-- Payload Realtime complet sur UPDATE (accusés de lecture ✓✓, présence) :
-- sans cela seules la clé primaire et les colonnes modifiées sont transmises.
alter table public.messages replica identity full;
alter table public.users replica identity full;

-- Marquer comme lus les messages reçus d'une conversation. Le destinataire n'est pas
-- l'expéditeur : la politique messages_update_sender l'en empêcherait, d'où cette RPC
-- SECURITY DEFINER avec garde d'appartenance.
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
       and sender_id <> (select auth.uid())
       and status <> 'read';
    get diagnostics marked = row_count;
    update public.conversation_members
       set last_read_at = now()
     where conversation_id = conv_id
       and user_id = (select auth.uid());
    return marked;
end;
$$;

revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
