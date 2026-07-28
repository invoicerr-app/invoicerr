-- Additive: countryCode for explicit ISO 3166-1 alpha-2 override
ALTER TABLE "Company" ADD COLUMN "countryCode" TEXT;
ALTER TABLE "Client" ADD COLUMN "countryCode" TEXT;
