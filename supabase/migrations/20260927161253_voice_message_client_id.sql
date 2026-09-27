-- Le client fournit l'id du message vocal : le message optimiste affiché et la ligne
-- serveur partagent alors le même id, ce qui rend la fusion realtime/pagination sans doublon.
-- L'ancienne signature 5 args est supprimée (sinon CREATE OR REPLACE créerait une surcharge
-- qui hériterait du EXECUTE PUBLIC par défaut).
drop function if exists public.send_voice_message(uuid, text, text, bigint, integer);

create or replace function public.send_voice_message(
    conv_id uuid,
    storage_path text,
    mime_type text,
    size_bytes bigint,
    duration_seconds integer,
    message_id uuid default null
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
    insert into public.messages (id, conversation_id, sender_id, content, type, status)
    values (coalesce(message_id, gen_random_uuid()), conv_id, (select auth.uid()), '', 'audio', 'sent')
    returning * into created;
    insert into public.attachments (message_id, url, mime_type, size_bytes, duration_seconds)
    values (created.id, storage_path, mime_type, size_bytes, duration_seconds);
    return created;
end;
$$;

revoke execute on function public.send_voice_message(uuid, text, text, bigint, integer, uuid) from public, anon;
grant execute on function public.send_voice_message(uuid, text, text, bigint, integer, uuid) to authenticated;
