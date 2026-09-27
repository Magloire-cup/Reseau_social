-- Durcissement : ces deux fonctions ne sont pas des endpoints RPC publics.
-- Les privilèges par défaut de Supabase accordent EXECUTE à anon/authenticated
-- sur toute nouvelle fonction de public ; on les retire explicitement.

-- handle_new_user n'est appelée que par le trigger on_auth_user_created
-- (les privilèges EXECUTE des fonctions de trigger ne sont vérifiés qu'à la
-- création du trigger, pas à chaque exécution).
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- is_conversation_member reste exécutable par authenticated : les politiques
-- RLS l'appellent, et elle ne révèle que l'appartenance de l'appelant.
revoke execute on function public.is_conversation_member(uuid) from public, anon;
