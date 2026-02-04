export { BaseFormatGenerator } from './base.generator';
export { FacturXGenerator } from './facturx.generator';
export { UBLGenerator } from './ubl.generator';
export { FatturaPAGenerator } from './fatturapa.generator';

import { FormatGenerator } from '../format.interface';
import { BaseFormatGenerator } from './base.generator';
import { FacturXGenerator } from './facturx.generator';
import { UBLGenerator } from './ubl.generator';
import { FatturaPAGenerator } from './fatturapa.generator';

/**
 * Format generator registry
 */
const generators: FormatGenerator[] = [
  new FacturXGenerator(),
  new UBLGenerator(),
  new FatturaPAGenerator(),
];

/**
 * Get format generator by name
 */
export function getGenerator(name: string): FormatGenerator | null {
  return generators.find(g => g.name === name) || null;
}

/**
 * Get format generator by format name
 */
export function getGeneratorByFormat(format: string): FormatGenerator | null {
  return generators.find(g => g.supports(format)) || null;
}

/**
 * Get all supported formats
 */
export function getSupportedFormats(): string[] {
  const formats = new Set<string>();
  generators.forEach(g => g.supportedFormats.forEach(f => formats.add(f)));
  return Array.from(formats);
}
