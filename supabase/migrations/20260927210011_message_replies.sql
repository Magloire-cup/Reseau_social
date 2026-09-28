-- Répondre à un message : chaque message peut citer le message auquel il répond.
-- Si la source est supprimée, la réponse survit sans citation.
-- if not exists : le fichier est rejouable (l'aperçu Supabase rejoue les migrations).
alter table public.messages
    add column if not exists reply_to_id uuid references public.messages (id) on delete set null;

create index if not exists messages_reply_to_id_idx on public.messages (reply_to_id);

-- Les vocaux peuvent aussi répondre à un message : la RPC accepte le message cité.
-- La 6-args est supprimée pour éviter une surcharge qui hériterait du EXECUTE PUBLIC par défaut.
drop function if exists public.send_voice_message(uuid, text, text, bigint, integer, uuid);

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
    if (select auth.uid()) is null then
        raise exception 'Authentification requise.';
    end if;
    if reply_to is not null and not exists (
        select 1 from public.messages where id = reply_to and conversation_id = conv_id
    ) then
        raise exception 'Message cité introuvable.';
    end if;
    insert into public.messages (id, conversation_id, sender_id, content, type, status, reply_to_id)
    values (coalesce(message_id, gen_random_uuid()), conv_id, (select auth.uid()), '', 'audio', 'sent', reply_to)
    returning * into created;
    insert into public.attachments (message_id, url, mime_type, size_bytes, duration_seconds)
    values (created.id, storage_path, mime_type, size_bytes, duration_seconds);
    return created;
end;
$$;
revoke execute on function public.send_voice_message(uuid, text, text, bigint, integer, uuid, uuid) from public, anon;
grant execute on function public.send_voice_message(uuid, text, text, bigint, integer, uuid, uuid) to authenticated;
