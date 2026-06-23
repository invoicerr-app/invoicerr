---
sidebar_position: 5
---

# Signature de devis

La page **Quote Signing** est le côté client du processus de devis. Quand vous envoyez un devis pour signature, votre client reçoit un e-mail avec un lien sécurisé vers `/signature/[id]` — aucun compte requis.

## Le flux de signature

1. Vous cliquez sur **Send for signature** sur un [devis](quotes.md).
2. Invoicerr envoie au client un e-mail avec un lien de signature unique.
3. Le client ouvre le lien et voit un aperçu en lecture seule du devis.
4. Pour signer, le client saisit le **code OTP à 8 chiffres** envoyé par e-mail.
5. Après vérification de l'OTP, le client clique sur **Sign** pour approuver le devis.
6. Vous et le client pouvez **Download PDF** du devis signé.

## Expérience client

La page de signature affiche :

- Numéro du devis, date et date de validité
- Coordonnées de l'entreprise et du client
- Tableau complet des lignes (description, quantité, prix unitaire, TVA, total)
- Total hors taxe, total TVA et total général
- Bouton **Sign** (verrouillé tant que le bon OTP n'est pas saisi)

## Statuts

Après signature, le statut du devis passe à **Signed** dans votre interface, et l'action **Create invoice** devient disponible dans [Devis](quotes.md).

## Renvoi

Si le client n'a pas reçu l'e-mail, recliquez sur **Send for signature** sur le devis pour renvoyer le lien et un nouvel OTP.

## Premier usage

La première fois que vous envoyez un devis pour signature, vérifiez que l'adresse e-mail de votre client est correcte dans son [profil client](clients.md).
