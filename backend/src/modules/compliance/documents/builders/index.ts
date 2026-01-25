/**
 * Document Builders Index
 */

export { BaseDocumentBuilder } from './base.builder';
export { GenericDocumentBuilder } from './generic.builder';

import { BuilderType, IDocumentBuilder } from '../document.types';
import { GenericDocumentBuilder } from './generic.builder';

// Builder constructor type
type BuilderConstructor = new () => IDocumentBuilder;

/**
 * Builder Registry
 * Maps builder types to their implementations
 */
const builderRegistry = new Map<BuilderType, BuilderConstructor>();
builderRegistry.set('generic', GenericDocumentBuilder);
// Add country-specific builders here as they are implemented:
// builderRegistry.set('fr', FRDocumentBuilder);
// builderRegistry.set('pl', PLDocumentBuilder);

/**
 * Get a builder instance by type
 */
export function getBuilder(type: BuilderType): IDocumentBuilder {
  const BuilderClass = builderRegistry.get(type);
  if (!BuilderClass) {
    // Fallback to generic builder
    return new GenericDocumentBuilder();
  }
  return new BuilderClass();
}

/**
 * Check if a builder type is supported
 */
export function isBuilderSupported(type: BuilderType): boolean {
  return builderRegistry.has(type);
}

/**
 * Get all supported builder types
 */
export function getSupportedBuilders(): BuilderType[] {
  return Array.from(builderRegistry.keys());
}
