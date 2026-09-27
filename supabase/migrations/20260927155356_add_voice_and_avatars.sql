-- Messages vocaux + photos de profil : stockage Supabase Storage et envoi atomique des vocaux.

alter table public.attachments add column duration_seconds integer
    check (duration_seconds is null or duration_seconds >= 0);

-- Buckets : "avatars" public (affichage direct dans les listes), "voice-notes" privé (URLs signées).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
    ('voice-notes', 'voice-notes', false, 10485760, array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav'])
on conflict (id) do nothing;

-- Avatar : chacun ne gère que son dossier {user_id}/… (upsert = INSERT + SELECT + UPDATE).
create policy "avatars_insert_own" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars_select_own" on storage.objects
    for select to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars_update_own" on storage.objects
    for update to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars_delete_own" on storage.objects
    for delete to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Vocaux : dépôt et lecture réservés aux membres de la conversation {conversation_id}/…,
-- dépôt refusé si un blocage existe entre les deux participants.
create policy "voice_insert_member" on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'voice-notes'
        and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
        and not public.conversation_is_blocked(((storage.foldername(name))[1])::uuid)
    );

create policy "voice_select_member" on storage.objects
    for select to authenticated
    using (
        bucket_id = 'voice-notes'
        and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
    );

-- Envoi d'un vocal en une transaction : message (type 'audio') + pièce jointe atomiques,
-- ainsi le message diffusé en realtime possède toujours son fichier.
-- SECURITY INVOKER : la RLS de messages/attachments s'applique à l'appelant.
create or replace function public.send_voice_message(
    conv_id uuid,
    storage_path text,
    mime_type text,
    size_bytes bigint,
    duration_seconds integer
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
    insert into public.messages (conversation_id, sender_id, content, type, status)
    values (conv_id, (select auth.uid()), '', 'audio', 'sent')
    returning * into created;
    insert into public.attachments (message_id, url, mime_type, size_bytes, duration_seconds)
    values (created.id, storage_path, mime_type, size_bytes, duration_seconds);
    return created;
end;
$$;

revoke execute on function public.send_voice_message(uuid, text, text, bigint, integer) from public, anon;
grant execute on function public.send_voice_message(uuid, text, text, bigint, integer) to authenticated;
