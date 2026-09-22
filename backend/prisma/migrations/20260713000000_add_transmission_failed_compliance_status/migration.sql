-- F-4: honest send() outcome — a compliance document whose transmission channels all came back
-- SKIPPED/REJECTED now lands in TRANSMISSION_FAILED instead of being mislabelled DELIVERED /
-- PENDING_CLEARANCE. Additive only: no existing values are removed or renamed.

ALTER TYPE "ComplianceStatus" ADD VALUE 'TRANSMISSION_FAILED';
