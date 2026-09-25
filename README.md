# Pulse

Pulse est une messagerie web inspirée de WhatsApp avec backend TypeScript, authentification serveur, code utilisateur unique, sessions sécurisées, présence en ligne, blocage, IA et formulaire de contact.

## Démarrage

Node.js 20 ou plus récent est nécessaire.

```powershell
npm install
Copy-Item .env.example .env
```

Renseigne ensuite `.env`, puis lance :

```powershell
npm start
```

Le site sera disponible sur `http://localhost:3000`.

## Déployer sur Vercel

Le backend est exposé par `api/[...route].ts` et utilise Upstash Redis pour que les comptes et messages persistent entre les exécutions serverless.

1. Crée un projet Redis dans Upstash et récupère `KV_REST_API_URL` et `KV_REST_API_TOKEN`.
2. Installe Vercel puis connecte-toi :

```powershell
npm install -g vercel
vercel login
vercel
```

3. Ajoute dans les variables d’environnement Vercel :

`SESSION_SECRET`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `CONTACT_TO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` et éventuellement `GEMINI_API_KEY`.

4. Déploie en production :

```powershell
vercel --prod
```

Vercel sert automatiquement les pages HTML/CSS/JS et exécute les routes backend sous `/api/*`. Ne committe jamais `.env`, les mots de passe SMTP, les tokens Redis ou la clé Gemini.

## Email de contact

Le formulaire de `contact.html` utilise SMTP. Pour Gmail, active la validation en deux étapes et crée un mot de passe d'application. Renseigne `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` et `CONTACT_TO=maglo9501@gmail.com` dans `.env`.

Les secrets restent côté serveur et ne sont jamais envoyés au navigateur.

## Fonctions backend

- `PULSE-XXXXXXXX` est généré à l'inscription et permet de retrouver un utilisateur sans exposer son email.
- Le mot de passe est vérifié à chaque connexion et stocké avec `scrypt`.
- La présence est mise à jour par session et les conversations se rafraîchissent automatiquement.
- Le blocage est disponible via l'API `/api/users/:code/block`.
- `/api/ai` utilise Gemini si `GEMINI_API_KEY` existe, sinon une réponse locale est fournie.
- Le sélecteur FR/EN est conservé dans le navigateur et traduit les textes de l'interface.
