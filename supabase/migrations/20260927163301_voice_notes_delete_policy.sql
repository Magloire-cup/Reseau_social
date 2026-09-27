-- Libération de l'espace : les membres d'une conversation peuvent supprimer les fichiers
-- vocaux de cette conversation (fichier orphelin après un envoi interrompu, nettoyage).
create policy "voice_delete_member" on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'voice-notes'
        and public.is_conversation_member(((storage.foldername(name))[1])::uuid)
    );
