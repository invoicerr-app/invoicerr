-- TODO_PRODUIT.md T5(b) — rapprochement fournisseur des factures reçues : réutilise "Client" avec un
-- rôle, sous la forme d'un booléen SÉPARÉ (jamais une extension de "kind") — voir le commentaire du
-- champ "isSupplier" dans schema.prisma pour le POURQUOI (kind/GOVERNMENT est un fait de ROUTAGE B2G,
-- "est fournisseur de cette société" est un fait ORTHOGONAL sur le sens ENTRANT ; un client peut être
-- les deux à la fois, "kind" ne peut pas porter deux faits indépendants sans valeurs composites).
--
-- DEFAULT false, NOT NULL : le backfill réfléchi — tout client EXISTANT n'est PAS un fournisseur tant
-- que le rapprochement (auto ou manuel, received-invoices/supplier-reconciliation.ts) ne l'a pas posé
-- explicitement. Additif pur, jamais renseigné automatiquement par cette migration elle-même.
ALTER TABLE "Client" ADD COLUMN "isSupplier" BOOLEAN NOT NULL DEFAULT false;
