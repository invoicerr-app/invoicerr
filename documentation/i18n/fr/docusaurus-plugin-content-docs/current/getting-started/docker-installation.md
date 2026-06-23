---
sidebar_position: 2
---

# Installation Docker (recommandée)

La façon la plus rapide de lancer Invoicerr est d'utiliser Docker Compose. Une image préconstruite est disponible sur [ghcr.io/invoicerr-app/invoicerr](https://ghcr.io/invoicerr-app/invoicerr).

## Architectures prises en charge

- `linux/amd64` (x86_64)
- `linux/arm64/v8` (ARMv8)

`linux/arm/v7` n'est pas pris en charge, car Prisma ne fournit pas de binaires précompilés pour cette architecture — l'application ne fonctionnera pas sur les appareils ARM 32 bits.

## Démarrage rapide

1. Clonez le dépôt :

   ```bash
   git clone https://github.com/invoicerr-app/invoicerr.git
   cd invoicerr
   ```

2. Modifiez `docker-compose.yml` pour définir vos variables d'environnement.

3. Lancez l'application :

   ```bash
   docker compose up -d
   ```

4. Ouvrez votre navigateur sur `http://localhost`.

## Variables d'environnement

Elles sont définies dans `docker-compose.yml` sous le service `invoicerr` :

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Chaîne de connexion PostgreSQL, ex. `postgresql://invoicerr:invoicerr@invoicerr_db:5432/invoicerr_db` |
| `APP_URL` | URL publique complète du frontend (ex. `https://invoicerr.example.com`). Requise pour les modèles d'e-mail et les liens. |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | Identifiants et serveur utilisés pour l'envoi des e-mails (devis, factures, etc.) |
| `SMTP_FROM` | Optionnel — adresse d'expéditeur des e-mails. Par défaut `SMTP_USER` si omise. |
| `JWT_SECRET` | Optionnel mais recommandé pour l'authentification JWT. N'importe quelle chaîne aléatoire. Si non définie, un secret par défaut est utilisé, ce qui peut poser problème avec les déploiements Docker. |

Assurez-vous que le port 80 est disponible sur votre machine hôte, ou modifiez le mappage de port.
