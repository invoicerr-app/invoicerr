/*
  TODO_PRODUIT.md T2bis (2026-09-03) — decision mandant "generique seul, purger le par-type" (le
  vocabulaire complet valide juste apres). Purge 51 valeurs de l'enum "WebhookEvent" dont AUCUNE
  n'a d'emetteur reel dans backend/src (verifie par grep sur chaque valeur, dispatch litteral ET
  dynamique confondus — voir le rapport de la tache pour la preuve valeur par valeur) : les
  familles QUOTE_ (document), INVOICE_ (document), PAYMENT_ (document), RECEIPT_, PAYMENT_METHOD_
  et PAYMENT_RECEIVED, SIGNATURE_. INVOICE_SENT et QUOTE_SENT etaient les deux seules exceptions
  (actions/async-send.ts, depuis T2) — leur unique emetteur est remplace, dans le meme commit
  applicatif que cette migration, par le DOCUMENT_SENT generique ci-dessous, donc elles
  rejoignent la purge elles aussi. CLIENT_ et COMPANY_ (emetteurs reels : clients.service.ts,
  company.service.ts) et tout le reste de l'enum (WEBHOOK_, les evenements Item et
  Number-formatting, USER_, PLUGIN_, etc.) sont
  HORS PERIMETRE de cette tache (consigne dans TODO_ISSUES.md pour une decision separee), meme la
  ou un grep montrerait le meme silence.

  Ajoute 5 valeurs generiques, par-DOCUMENT plutot que par-type : DOCUMENT_CREATED, DOCUMENT_SENT,
  DOCUMENT_SEND_FAILED, DOCUMENT_AUTHORITY_EVENT, DOCUMENT_DELETED.

  Postgres ne sait pas faire un ALTER TYPE ... DROP VALUE : la seule voie est de reconstruire le
  type (CREATE le nouveau, convertir la colonne, renommer, jeter l'ancien — le meme motif que
  20251127192241_remove_unexisting_plugins_types, ici pour une colonne ARRAY de l'enum, jamais un
  scalaire). La colonne "Webhook"."events" est un WebhookEvent[] : un abonnement existant peut
  reference n'importe laquelle des 51 valeurs purgees — la nettoyer AVANT le swap de type est
  OBLIGATOIRE (une valeur absente du nouvel enum ferait echouer le cast juste apres), jamais une
  simple negligence : sans ce menage, une base de production avec un webhook deja configure sur
  "INVOICE_SENT" ferait echouer cette migration en plein milieu.
*/

-- Etape 1 : nettoie les abonnements EXISTANTS qui referencent une valeur sur le point d'etre
-- purgee — retire seulement ces valeurs-la du tableau "events" de chaque webhook concerne, laisse
-- tout le reste du tableau intact (un webhook qui suivait aussi CLIENT_CREATED garde CLIENT_CREATED).
UPDATE "Webhook"
SET "events" = (
  SELECT COALESCE(array_agg(e ORDER BY ord), ARRAY[]::"WebhookEvent"[])
  FROM unnest("events") WITH ORDINALITY AS u(e, ord)
  WHERE e::text NOT IN ('INVOICE_CREATED', 'INVOICE_CREATED_FROM_QUOTE', 'INVOICE_DELETED', 'INVOICE_MARKED_AS_PAID', 'INVOICE_OVERDUE', 'INVOICE_PAID', 'INVOICE_PDF_GENERATED', 'INVOICE_SEARCHED', 'INVOICE_SENT', 'INVOICE_STATUS_CHANGED', 'INVOICE_UPDATED', 'INVOICE_XML_DOWNLOADED', 'PAYMENT_CREATED', 'PAYMENT_CREATED_FROM_INVOICE', 'PAYMENT_DELETED', 'PAYMENT_METHOD_ACTIVATED', 'PAYMENT_METHOD_CREATED', 'PAYMENT_METHOD_DEACTIVATED', 'PAYMENT_METHOD_DELETED', 'PAYMENT_METHOD_UPDATED', 'PAYMENT_PDF_GENERATED', 'PAYMENT_RECEIVED', 'PAYMENT_SEARCHED', 'PAYMENT_SENT', 'PAYMENT_UPDATED', 'QUOTE_CREATED', 'QUOTE_DELETED', 'QUOTE_EXPIRED', 'QUOTE_MARKED_AS_SIGNED', 'QUOTE_PDF_GENERATED', 'QUOTE_REJECTED', 'QUOTE_SEARCHED', 'QUOTE_SENT', 'QUOTE_SIGNED', 'QUOTE_STATUS_CHANGED', 'QUOTE_UPDATED', 'QUOTE_VIEWED', 'RECEIPT_CREATED', 'RECEIPT_CREATED_FROM_INVOICE', 'RECEIPT_DELETED', 'RECEIPT_PDF_GENERATED', 'RECEIPT_SEARCHED', 'RECEIPT_SENT', 'RECEIPT_UPDATED', 'SIGNATURE_COMPLETED', 'SIGNATURE_CREATED', 'SIGNATURE_EMAIL_SENT', 'SIGNATURE_EXPIRED', 'SIGNATURE_OTP_GENERATED', 'SIGNATURE_OTP_SENT', 'SIGNATURE_VIEWED')
)
WHERE "events" && ARRAY['INVOICE_CREATED'::"WebhookEvent", 'INVOICE_CREATED_FROM_QUOTE'::"WebhookEvent", 'INVOICE_DELETED'::"WebhookEvent", 'INVOICE_MARKED_AS_PAID'::"WebhookEvent", 'INVOICE_OVERDUE'::"WebhookEvent", 'INVOICE_PAID'::"WebhookEvent", 'INVOICE_PDF_GENERATED'::"WebhookEvent", 'INVOICE_SEARCHED'::"WebhookEvent", 'INVOICE_SENT'::"WebhookEvent", 'INVOICE_STATUS_CHANGED'::"WebhookEvent", 'INVOICE_UPDATED'::"WebhookEvent", 'INVOICE_XML_DOWNLOADED'::"WebhookEvent", 'PAYMENT_CREATED'::"WebhookEvent", 'PAYMENT_CREATED_FROM_INVOICE'::"WebhookEvent", 'PAYMENT_DELETED'::"WebhookEvent", 'PAYMENT_METHOD_ACTIVATED'::"WebhookEvent", 'PAYMENT_METHOD_CREATED'::"WebhookEvent", 'PAYMENT_METHOD_DEACTIVATED'::"WebhookEvent", 'PAYMENT_METHOD_DELETED'::"WebhookEvent", 'PAYMENT_METHOD_UPDATED'::"WebhookEvent", 'PAYMENT_PDF_GENERATED'::"WebhookEvent", 'PAYMENT_RECEIVED'::"WebhookEvent", 'PAYMENT_SEARCHED'::"WebhookEvent", 'PAYMENT_SENT'::"WebhookEvent", 'PAYMENT_UPDATED'::"WebhookEvent", 'QUOTE_CREATED'::"WebhookEvent", 'QUOTE_DELETED'::"WebhookEvent", 'QUOTE_EXPIRED'::"WebhookEvent", 'QUOTE_MARKED_AS_SIGNED'::"WebhookEvent", 'QUOTE_PDF_GENERATED'::"WebhookEvent", 'QUOTE_REJECTED'::"WebhookEvent", 'QUOTE_SEARCHED'::"WebhookEvent", 'QUOTE_SENT'::"WebhookEvent", 'QUOTE_SIGNED'::"WebhookEvent", 'QUOTE_STATUS_CHANGED'::"WebhookEvent", 'QUOTE_UPDATED'::"WebhookEvent", 'QUOTE_VIEWED'::"WebhookEvent", 'RECEIPT_CREATED'::"WebhookEvent", 'RECEIPT_CREATED_FROM_INVOICE'::"WebhookEvent", 'RECEIPT_DELETED'::"WebhookEvent", 'RECEIPT_PDF_GENERATED'::"WebhookEvent", 'RECEIPT_SEARCHED'::"WebhookEvent", 'RECEIPT_SENT'::"WebhookEvent", 'RECEIPT_UPDATED'::"WebhookEvent", 'SIGNATURE_COMPLETED'::"WebhookEvent", 'SIGNATURE_CREATED'::"WebhookEvent", 'SIGNATURE_EMAIL_SENT'::"WebhookEvent", 'SIGNATURE_EXPIRED'::"WebhookEvent", 'SIGNATURE_OTP_GENERATED'::"WebhookEvent", 'SIGNATURE_OTP_SENT'::"WebhookEvent", 'SIGNATURE_VIEWED'::"WebhookEvent"]::"WebhookEvent"[];

-- Etape 2 : reconstruit le type enum lui-meme sans les 51 valeurs purgees, avec les 5 nouvelles.
BEGIN;
CREATE TYPE "WebhookEvent_new" AS ENUM (
  'DOCUMENT_CREATED',
  'DOCUMENT_SENT',
  'DOCUMENT_SEND_FAILED',
  'DOCUMENT_AUTHORITY_EVENT',
  'DOCUMENT_DELETED',
  'CLIENT_CREATED',
  'CLIENT_UPDATED',
  'CLIENT_DELETED',
  'CLIENT_ACTIVATED',
  'CLIENT_DEACTIVATED',
  'CLIENT_SEARCHED',
  'COMPANY_CREATED',
  'COMPANY_UPDATED',
  'COMPANY_PDF_CONFIG_UPDATED',
  'COMPANY_EMAIL_TEMPLATE_UPDATED',
  'COMPANY_INFO_VIEWED',
  'RECURRING_INVOICE_CREATED',
  'RECURRING_INVOICE_UPDATED',
  'RECURRING_INVOICE_DELETED',
  'RECURRING_INVOICE_GENERATED',
  'RECURRING_INVOICE_AUTO_SENT',
  'RECURRING_INVOICE_PROCESSED',
  'RECURRING_INVOICE_NEXT_DATE_CALCULATED',
  'PLUGIN_ACTIVATED',
  'PLUGIN_DEACTIVATED',
  'PLUGIN_CONFIGURED',
  'PLUGIN_ADDED',
  'PLUGIN_REMOVED',
  'PLUGIN_VALIDATED',
  'PLUGIN_PROVIDER_REQUESTED',
  'PLUGIN_FORMAT_REQUESTED',
  'PLUGIN_WEBHOOK_RECEIVED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_LOGGED_IN',
  'USER_PASSWORD_CHANGED',
  'USER_PROFILE_UPDATED',
  'USER_OIDC_LOGIN',
  'USER_OIDC_CALLBACK',
  'EMAIL_SENT',
  'EMAIL_TEMPLATE_UPDATED',
  'EMAIL_FAILED',
  'DASHBOARD_VIEWED',
  'DASHBOARD_STATS_CALCULATED',
  'STATS_MONTHLY_REQUESTED',
  'STATS_YEARLY_REQUESTED',
  'CURRENCY_RATE_UPDATED',
  'APP_RESET',
  'APP_ALL_DATA_RESET',
  'OTP_REQUESTED',
  'OTP_VALIDATED',
  'OTP_EXPIRED',
  'SEARCH_PERFORMED',
  'PDF_GENERATED',
  'XML_GENERATED',
  'FILE_DOWNLOADED',
  'WEBHOOK_CREATED',
  'WEBHOOK_UPDATED',
  'WEBHOOK_DELETED',
  'WEBHOOK_TRIGGERED',
  'WEBHOOK_FAILED',
  'QUOTE_ITEM_CREATED',
  'QUOTE_ITEM_UPDATED',
  'QUOTE_ITEM_DELETED',
  'INVOICE_ITEM_CREATED',
  'INVOICE_ITEM_UPDATED',
  'INVOICE_ITEM_DELETED',
  'PAYMENT_ITEM_CREATED',
  'PAYMENT_ITEM_UPDATED',
  'PAYMENT_ITEM_DELETED',
  'RECEIPT_ITEM_CREATED',
  'RECEIPT_ITEM_UPDATED',
  'RECEIPT_ITEM_DELETED',
  'RECURRING_INVOICE_ITEM_CREATED',
  'RECURRING_INVOICE_ITEM_UPDATED',
  'RECURRING_INVOICE_ITEM_DELETED',
  'PDF_CONFIG_CREATED',
  'PDF_CONFIG_UPDATED',
  'EMAIL_TEMPLATE_CREATED',
  'QUOTE_NUMBER_GENERATED',
  'INVOICE_NUMBER_GENERATED',
  'PAYMENT_NUMBER_GENERATED',
  'RECEIPT_NUMBER_GENERATED',
  'CRON_JOB_STARTED',
  'CRON_JOB_COMPLETED',
  'CRON_JOB_FAILED',
  'CURRENCY_CONVERSION_REQUESTED',
  'CURRENCY_RATE_FETCHED',
  'MAIL_TEMPLATE_CREATED',
  'MAIL_TEMPLATE_UPDATED',
  'SSE_CONNECTION_ESTABLISHED',
  'SSE_DATA_STREAMED',
  'DATA_VALIDATED',
  'CONFIGURATION_VALIDATED'
);
ALTER TABLE "Webhook" ALTER COLUMN "events" TYPE "WebhookEvent_new"[] USING ("events"::text[]::"WebhookEvent_new"[]);
ALTER TYPE "WebhookEvent" RENAME TO "WebhookEvent_old";
ALTER TYPE "WebhookEvent_new" RENAME TO "WebhookEvent";
DROP TYPE "WebhookEvent_old";
COMMIT;
