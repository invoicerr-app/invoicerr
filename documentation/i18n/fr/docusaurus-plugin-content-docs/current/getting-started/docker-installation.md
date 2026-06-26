---
sidebar_position: 2
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Installation Docker (recommandée)

La façon la plus rapide de lancer Invoicerr est d'utiliser Docker Compose. Une image préconstruite est disponible sur [ghcr.io/invoicerr-app/invoicerr](https://ghcr.io/invoicerr-app/invoicerr).

## Architectures prises en charge

- `linux/amd64` (x86_64)
- `linux/arm64/v8` (ARMv8)

:::warning `linux/arm/v7` n'est pas pris en charge
Prisma ne fournit pas de binaires précompilés pour cette architecture — l'application ne fonctionnera pas sur les appareils ARM 32 bits.
:::

## Démarrage rapide

1. Créez un fichier `docker-compose.yml` avec le contenu suivant, puis ajustez les variables d'environnement à votre configuration :

   ```yaml title="docker-compose.yml"
   services:
     invoicerr:
       image: ghcr.io/invoicerr-app/invoicerr:latest
       ports:
         - "80:80"
       environment:
         - DATABASE_URL=postgresql://invoicerr:invoicerr@invoicerr_db:5432/invoicerr_db
         - APP_URL=https://invoicerr.example.com
         - CORS_ORIGINS=http://localhost:5173,https://invoicerr.example.com

         # Envoi des e-mails - voir "Envoi des e-mails" ci-dessous pour l'alternative Brevo
         - SMTP_HOST=smtp-relay.example.com
         - SMTP_USER="username@example.com"
         - SMTP_FROM="user-from@example.com"
         - SMTP_PASSWORD="your_smtp_password"
         - SMTP_PORT=587
         - SMTP_SECURE=false

         - JWT_SECRET="your_jwt_secret"
       depends_on:
         - invoicerr_db

     invoicerr_db:
       image: postgres:15
       environment:
         POSTGRES_USER: invoicerr
         POSTGRES_PASSWORD: invoicerr
         POSTGRES_DB: invoicerr_db
       volumes:
         - db_data:/var/lib/postgresql/data

   volumes:
     db_data:
       driver: local
   ```

2. Lancez l'application :

   ```bash
   docker compose up -d
   ```

3. Ouvrez votre navigateur sur `http://localhost`.

:::tip
Le fichier [`docker-compose.yml`](https://github.com/invoicerr-app/invoicerr/blob/main/docker-compose.yml) du dépôt contient aussi un exemple OIDC commenté, utile pour activer l'authentification unique.
:::

## Variables d'environnement

Elles se définissent sous la clé `environment` du service `invoicerr`.

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Chaîne de connexion PostgreSQL, ex. `postgresql://invoicerr:invoicerr@invoicerr_db:5432/invoicerr_db` |
| `APP_URL` | URL publique complète du frontend (ex. `https://invoicerr.example.com`). Requise pour les modèles d'e-mail et les liens. |
| `JWT_SECRET` | Optionnel mais recommandé pour l'authentification JWT. N'importe quelle chaîne aléatoire. Si non définie, un secret par défaut est utilisé, ce qui peut poser problème avec les déploiements Docker. |

Assurez-vous que le port 80 est disponible sur votre machine hôte, ou modifiez le mappage de port.

## Envoi des e-mails

Invoicerr a besoin d'envoyer des e-mails (notifications de devis/facture, liens de signature). Choisissez **un** fournisseur avec `MAIL_PROVIDER` :

<Tabs>
<TabItem value="smtp" label="SMTP (par défaut)">

```yaml
- MAIL_PROVIDER=smtp # peut être omis, c'est la valeur par défaut
- SMTP_HOST=smtp-relay.example.com
- SMTP_USER="username@example.com"
- SMTP_FROM="user-from@example.com" # optionnel, par défaut SMTP_USER
- SMTP_PASSWORD="your_smtp_password"
- SMTP_PORT=587 # port SMTP par défaut pour TLS
- SMTP_SECURE=false # mettre à true si votre serveur SMTP requiert une connexion sécurisée
```

| Variable | Description |
| --- | --- |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | Identifiants et serveur utilisés pour l'envoi des e-mails |
| `SMTP_FROM` | Optionnel — adresse d'expéditeur. Par défaut `SMTP_USER` si omise |
| `SMTP_PORT` | Port SMTP (par défaut `587`) |
| `SMTP_SECURE` | Mettre à `true` si votre serveur SMTP requiert une connexion sécurisée |

</TabItem>
<TabItem value="brevo" label="Brevo">

```yaml
- MAIL_PROVIDER=brevo
- BREVO_API_KEY="your_brevo_api_key"
- MAIL_FROM="user-from@example.com" # optionnel, retombe sur SMTP_FROM/SMTP_USER
```

| Variable | Description |
| --- | --- |
| `BREVO_API_KEY` | Clé API pour envoyer les e-mails via l'API transactionnelle [Brevo](https://www.brevo.com/) au lieu de SMTP |
| `MAIL_FROM` | Optionnel — adresse d'expéditeur. Retombe sur `SMTP_FROM`, puis `SMTP_USER`, si non définie |

:::info
Utilisez Brevo si vous ne voulez pas gérer ou payer un relais SMTP — les e-mails passent alors par l'API HTTP de Brevo.
:::

</TabItem>
</Tabs>
