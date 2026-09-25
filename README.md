# Pulse

Pulse est une messagerie web inspirée de WhatsApp avec authentification serveur, sessions sécurisées, conversations persistées et formulaire de contact.

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

## Email de contact

Le formulaire de `contact.html` utilise SMTP. Pour Gmail, active la validation en deux étapes et crée un mot de passe d'application. Renseigne `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` et `CONTACT_TO=maglo9501@gmail.com` dans `.env`.

Les secrets restent côté serveur et ne sont jamais envoyés au navigateur.
