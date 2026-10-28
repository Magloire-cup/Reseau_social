# Pulse Messenger

Application de messagerie existante : Next.js 15, React 19, TypeScript, Clerk, Supabase et Gemini. Les interfaces français/anglais et les thèmes clair/sombre sont conservés. Le développement se fait par lots ; cette version ne constitue pas encore une plateforme complète prête pour la production.

## Démarrage local

Prérequis : Node.js 22.18 ou supérieur, npm, et Chrome ou Edge installé pour les tests navigateur.

```sh
npm ci
npm run dev -- --hostname localhost
```

L'application est accessible sur `http://localhost:3000`. Utiliser le même nom d'hôte dans le serveur et le navigateur pour éviter une réécriture vers une origine locale différente. Configurer les services avant de tester les parcours connectés. Ne jamais publier de fichier d'environnement ou de secret.

### Configuration

| Variable | Usage |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clé publique de l'instance Clerk |
| `CLERK_SECRET_KEY` | Clé Clerk côté serveur uniquement |
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clé publique Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Ancien format accepté ; prioritaire si les deux clés publiques sont définies |
| `GEMINI_API_KEY` | Appels Gemini côté serveur uniquement |
| `GEMINI_MODEL` | Modèle disponible pour le projet Google ; vérifier sa disponibilité avant usage |
| `TURN_URLS` | Adresses TURN séparées par des virgules |
| `TURN_USERNAME`, `TURN_CREDENTIAL` | Identifiants TURN serveur pour les appels |

Les variables `NEXT_PUBLIC_*` sont publiques. Ne jamais leur affecter une clé Supabase `service_role`, une clé Clerk secrète ou une clé Gemini.

### Clerk et Supabase

L'authentification actuelle utilise **Clerk**, pas Supabase Email/Password. Le code demande un jeton via `getToken({ template: "supabase" })` : le template Clerk `supabase` et la confiance JWT/Third-Party Auth côté Supabase doivent correspondre à l'instance utilisée. Les identifiants Clerk sont des chaînes et les politiques actuelles utilisent le sujet `sub` du JWT.

Les migrations ordonnées de `supabase/migrations/` décrivent le schéma cumulatif, y compris la migration des identifiants historiques vers Clerk. Toute application sur une base distante nécessite une validation et une autorisation explicites ; ne pas rejouer ou réinitialiser une base existante pour démarrer l'interface.

Les requêtes de messagerie utilisent la clé publique et le jeton de la personne connectée, sans client privilégié. Les vérifications serveur complètent les politiques RLS existantes ; elles ne les remplacent pas. Vérifier les droits Data API, RLS, Realtime et Storage sur un environnement de test autorisé avant déploiement.

## État des fonctionnalités

| Domaine | État |
| --- | --- |
| Authentification et profils | Intégration Clerk, nom, pseudo, bio, avatar ; parcours réels non revalidés dans ce lot |
| Conversations privées et groupes | Création, historique paginé, présence, saisie et accusés de lecture présents |
| Messages texte | Envoi, réponse, réactions, suppression avec marqueur ; messages envoyés à droite et reçus à gauche |
| Nouveau lot texte | Copier, modifier ses textes, transférer un texte et rechercher dans l'historique de la conversation |
| Vocaux | Enregistrement, upload et lecture présents ; pas de copie, modification ou transfert audio dans ce lot |
| Appels | Signalisation et appels WebRTC audio/vidéo présents ; TURN et essais multi-appareils restent nécessaires |
| Gemini | Conversation dédiée présente, mais réponse de secours locale en cas d'absence de clé ou d'échec ; cela ne prouve pas un appel IA réussi |
| Notifications et installation | Notifications navigateur avec consentement et PWA ; pas de Web Push hors application |
| Confidentialité | Blocage de contacts présent ; réglages avancés, export et suppression de compte restent à compléter |
| Médias et groupes avancés | Images/vidéos/fichiers dans le chat, rôles et gestion complète des membres restent à implémenter |
| Autres fonctions | Stories/statuts, épinglage, archivage et sourdine par conversation restent à implémenter |

La recherche porte sur les messages `text` non supprimés, pas sur les réponses Gemini de type `ai` ni sur les médias. Elle affiche et permet de copier les résultats ; elle ne navigue pas vers une position historique dans la discussion.

## API de messagerie

Toutes les opérations de `/api/messages` exigent une session Clerk et l'appartenance à la conversation. Les UUID sont validés strictement et normalisés. Les corps JSON POST/PATCH sont limités à 64 Kio réellement lus ; les propriétés non prévues sont rejetées.

### Lecture et recherche — GET

Paramètres :

- `conversationId` : UUID obligatoire.
- `q` : recherche facultative, de 1 à 200 caractères après suppression des espaces extérieurs.
- `beforeCreatedAt` et `beforeId` : curseur facultatif, obligatoirement fourni en paire.

Réponse : `{ messages, nextCursor }`, avec au plus 50 messages triés par `created_at DESC, id DESC`. Le curseur `{ createdAt, id }` conserve les microsecondes PostgreSQL ; le retransmettre sans conversion par `Date`.

La recherche est une sous-chaîne littérale insensible à la casse via `imatch` et échappement des opérateurs regex. Les caractères `*`, `%`, `_`, les parenthèses et les antislashs ne deviennent pas des jokers fournis par le client. La compatibilité du serveur PostgREST et les performances sur gros historiques doivent encore être vérifiées sur une base de test autorisée.

### Envoi texte — POST

```json
{
  "conversationId": "10000000-0000-4000-8000-000000000001",
  "messageId": "20000000-0000-4000-8000-000000000001",
  "content": "Bonjour",
  "type": "text",
  "replyToId": null
}
```

`messageId`, `type` et `replyToId` sont facultatifs. Le contenu doit être une chaîne non vide, sans caractère nul, limitée à 4 000 caractères avant suppression des espaces extérieurs. Une citation doit désigner un message non supprimé de la même conversation.

Le serveur fixe l'auteur et les métadonnées. Une nouvelle insertion renvoie HTTP 201 avec `{ message }`. Une répétition du même identifiant, de la même destination, du même auteur, du même texte et de la même citation renvoie le message existant avec HTTP 200 ; une réutilisation incompatible renvoie 409.

L'interface conserve le brouillon après erreur et réutilise l'identifiant sur une reprise identique. Après succès, ou si la destination, le texte ou la citation changent, l'envoi reçoit un nouvel identifiant. Cette protection reste en mémoire : elle ne constitue pas une boîte d'envoi persistante après rechargement de la page, et ne couvre pas le parcours Gemini.

### Modification — PATCH

```json
{
  "conversationId": "10000000-0000-4000-8000-000000000001",
  "messageId": "20000000-0000-4000-8000-000000000001",
  "content": "Bonjour modifié",
  "previousContent": "Bonjour"
}
```

Seul l'auteur peut modifier un texte non supprimé. La condition `previousContent` est comparée exactement dans le même UPDATE que la modification ; aucune conversion ou suppression d'espace ne s'applique à cette valeur. Une concurrence ou un message non modifiable donne HTTP 409 ; le brouillon reste affiché. Aucun champ `edited_at` ni historique de versions n'est ajouté.

L'interface applique les modifications Realtime aux messages déjà chargés, même anciens. Une réponse PATCH tardive n'écrase pas un contenu local différent plus récent et ne rétablit pas un message supprimé. Sans version serveur, les modifications ramenant exactement le texte à sa valeur initiale ne sont pas distinguables.

### Transfert — POST

```json
{
  "conversationId": "10000000-0000-4000-8000-000000000002",
  "messageId": "20000000-0000-4000-8000-000000000002",
  "forwardMessageId": "20000000-0000-4000-8000-000000000001"
}
```

Ces trois propriétés sont obligatoires, sans contenu ou auteur fourni par le client. Le serveur vérifie l'accès à la source et à la destination, puis copie le texte courant d'un message non supprimé. Aucun auteur d'origine, citation, réaction ou marqueur de transfert n'est copié. La destination doit être privée ou de groupe. Le blocage reste appliqué par les politiques INSERT existantes.

### Erreurs

- `400` : contrat invalide.
- `401` : session absente.
- `403` : insertion refusée par les règles d'accès.
- `404` : conversation, citation ou source absente/inaccessible.
- `409` : modification concurrente/non autorisée ou identifiant incompatible.
- `413` : corps JSON trop volumineux.
- `503` : client Supabase indisponible.
- `500` : erreur interne générique, sans détails SQL exposés.

Les autres routes existantes incluent `/api/chat`, `/api/conversations`, `/api/users` et `/api/ice` ; leurs contrats et garanties ne sont pas remplacés par ceux de `/api/messages`.

## Vérifications locales

```sh
npm test
npm run test:browser
npm run typecheck -- --incremental false
npm run build
```

- `npm test` : validation et contrats API ; véritable générateur de requêtes Supabase, transport HTTP et identité simulés. Aucun appel à une base distante. L'option de simulation des modules du test runner Node est expérimentale.
- `npm run test:browser` : vrais composants React/CSS dans Chrome ou Edge, servis sur loopback par un petit serveur local. Clerk, Supabase, appels, IA et profils sont remplacés par des fixtures ; les requêtes externes et WebSockets sont bloqués. Aucun navigateur téléchargé, aucun email envoyé, aucun fichier d'environnement lu par le harnais.
- Couverture navigateur : 390/1280 px, français/anglais, clair/sombre, alignement, retour à la ligne, clavier/focus, copie, édition, transfert, recherche, pagination, annulation des requêtes, messages anciens Realtime, brouillons et reprises après réponse perdue.
- Ces tests ne valident pas les politiques SQL réellement déployées, les uploads, l'authentification réelle, la délivrabilité des emails, Gemini ou les appels entre appareils.
- Ne pas lancer `next build` et `next dev` simultanément sur le même dossier `.next`. Le cache `tsconfig.tsbuildinfo` n'est pas un livrable du lot.

## Sécurité et déploiement

Le lot texte ne contient aucune migration et n'applique aucune modification distante. Le déploiement Vercel et tout push nécessitent une autorisation séparée.

Avant de considérer l'application prête pour la production :

1. Résoudre les alertes de dépendances signalées par l'audit npm, notamment Next.js, PostCSS, sharp et source-map-js ; Next.js n'a pas été mis à niveau dans ce lot.
2. Ajouter une limitation de débit côté serveur et valider les politiques RLS/Storage réelles, y compris l'accès direct à la Data API.
3. Tester appels/TURN, uploads, sessions réelles et persistance dans un environnement explicitement autorisé.
4. Fiabiliser Gemini : éviter une réponse de secours présentée comme une vraie réponse IA et contrôler les erreurs de persistance.
5. Compléter les fonctions manquantes ci-dessus, avec tests et contrôle d'accès serveur.

Les messages sont stockés côté serveur ; aucune garantie de chiffrement de bout en bout n'est revendiquée.
