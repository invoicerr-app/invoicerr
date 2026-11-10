-- Default true so every client existing at migration time keeps today's behaviour, which treats a
-- business client as VAT-registered. A private client is never asked the question.
ALTER TABLE "Client" ADD COLUMN "vatRegistered" BOOLEAN NOT NULL DEFAULT true;
