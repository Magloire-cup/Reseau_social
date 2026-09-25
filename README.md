# Pulse

Pulse est une interface de messagerie statique avec conversations locales, groupes et assistant Gemini.

## Lancer Gemini

Node.js 20.6 ou plus récent est nécessaire.

```powershell
npm install
Copy-Item .env.example .env
```

Ouvre `.env`, renseigne `GEMINI_API_KEY`, puis lance :

```powershell
npm run dev
```

Le site sera disponible sur `http://localhost:3000`.

La clé Gemini est lue uniquement par `gemini-server.mjs`. Elle ne doit jamais être écrite dans un fichier HTML ou JavaScript envoyé au navigateur.

## Fonctionnement

- Chaque compte local possède une seule discussion Gemini.
- « Supprimer et recommencer » efface l'ancienne discussion de cet utilisateur.
- Les conversations Pulse restent locales dans le navigateur.
- Pour une vraie application multi-utilisateur, il faudra ajouter une base de données, une authentification serveur et des sessions sécurisées.
