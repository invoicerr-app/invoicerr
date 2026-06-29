/**
 * Compliance module (pure, framework-agnostic). See COMPLIANCE_ARCHITECTURE.md.
 * The resolution core (engine + profiles) is fully implemented; the execution layer
 * (providers/handlers) is wired end-to-end with stub bodies that log TODO where an external
 * integration is required. Wire-up into the NestJS invoice flow happens in a later phase.
 */

// --- Resolution core ---
export * from './types';
export * from './canonical/canonical-document';
export * from './canonical/identifier-validator';
export * from './canonical/identifier-existence.port';
export * from './profiles/schema';
export * from './profiles/temporal';
export * from './profiles/archetypes';
export * from './profiles/data/all';
export * from './profiles/registry';
export * from './engine/classification';
export * from './engine/tax-engine';
export * from './engine/compliance-engine';

// --- Execution layer ---
export * from './execution/logger';
export * from './execution/types';
export * from './execution/executor';

// --- Providers ---
export * from './providers/format/format-provider';
export * from './providers/format/providers';
export * from './providers/format/registry';
export * from './providers/signing/signing-provider';
export * from './providers/signing/providers';
export * from './providers/signing/registry';
export * from './providers/transmission/transmission-provider';
export * from './providers/transmission/channel-credentials-port';
export * from './providers/transmission/providers';
export * from './providers/transmission/registry';
export * from './providers/archive/archive-provider';
export * from './providers/archive/providers';
export * from './providers/archive/registry';

// --- Axis handlers ---
export * from './regimes/regime-handler';
export * from './regimes/handlers';
export * from './regimes/registry';
export * from './taxsystems/tax-system';
export * from './taxsystems/handlers';
export * from './taxsystems/registry';
export * from './reporting/reporting-handler';
export * from './reporting/handlers';
export * from './reporting/registry';

// --- Lifecycle ---
export * from './lifecycle/state-machine';
export * from './lifecycle/numbering';
export * from './lifecycle/corrections';
export * from './lifecycle/response';

// --- Inbound reception ---
export * from './reception/reception-service';

// --- Operations facade (one method per lifecycle operation) ---
export * from './operations/types';
export * from './operations/document-store';
export * from './operations/compliance-service';
