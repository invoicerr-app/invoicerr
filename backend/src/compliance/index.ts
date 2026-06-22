/**
 * Compliance core (pure, framework-agnostic). See COMPLIANCE_ARCHITECTURE.md.
 * Wire-up into the NestJS invoice flow happens in later phases; this module is independently
 * testable and has no dependency on Prisma, Nest, or any external service.
 */
export * from './types';
export * from './canonical/canonical-document';
export * from './profiles/schema';
export * from './profiles/temporal';
export * from './profiles/registry';
export * from './engine/classification';
export * from './engine/tax-engine';
export * from './engine/compliance-engine';
