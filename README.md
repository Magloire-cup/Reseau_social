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
DATABASE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Ne mets jamais `GEMINI_API_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` dans un composant client, `public/` ou GitHub.

## Supabase

1. Crée un projet Supabase.
2. Exécute `supabase/schema.sql` dans l'éditeur SQL.
3. Active Email/Password dans Authentication.
4. Copie l'URL et la clé anon dans `.env.local`.
5. Active Realtime sur `messages` et `users` pour les notifications et la présence.

Le schéma contient `users`, `conversations`, `conversation_members`, `messages` et `attachments`, avec des politiques RLS pour isoler les conversations.

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
