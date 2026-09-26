# Pulse

Pulse est une application de messagerie moderne construite avec Next.js, React, TypeScript, Supabase et Gemini AI. Gemini apparaît comme une conversation normale dans la liste des discussions.

## Installation

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```
Ouvre `http://localhost:3000`.

## Variables d'environnement

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` est aussi accepté (ancien format). Ne mets jamais `GEMINI_API_KEY` dans un composant client, `public/` ou GitHub.

## Supabase

1. Crée un projet Supabase.
2. Applique les migrations : `npx supabase link --project-ref <ref>` puis `npx supabase db push` (ou exécute le SQL de `supabase/migrations/` dans l'éditeur SQL).
3. Active Email/Password dans Authentication.
4. Copie l'URL et la clé publique dans `.env.local`.

Le schéma contient `users`, `conversations`, `conversation_members`, `messages` et `attachments`, avec des politiques RLS pour isoler les conversations, un trigger qui crée le profil à l'inscription, et Realtime activé sur `messages`, `users` et `conversation_members`.

Pour tester à plusieurs utilisateurs sans boîte mail, activez la confirmation automatique (Dashboard Supabase → Authentication → Sign In / Up → « Confirm email » désactivé), sinon chaque inscription doit confirmer son email et Supabase limite le nombre d'emails envoyés.

## Gemini

La route `app/api/chat/route.ts` appelle Gemini avec `GEMINI_API_KEY`. Sans clé, elle renvoie un fallback local pour permettre le développement de l'interface.

## Déploiement Vercel

```powershell
npm run build
npm install -g vercel
vercel login
vercel --prod
```

Ajoute ensuite les mêmes variables dans les paramètres Vercel. Vercel détecte automatiquement Next.js et les routes App Router.

## Routes

- `/api/chat`: conversation Gemini multi-tours
- `/api/messages`: lecture et création de messages protégés
- `/api/conversations`: conversations de l'utilisateur connecté
- `/api/users`: recherche d'utilisateurs
