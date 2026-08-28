/**
 * P1-T03a — the DI wiring of ComplianceCoreModule, asserted without booting it.
 *
 * The defect this guards: `ComplianceService` was registered with
 * `{ store, executor, rangeSource }` and NO `formats`. Its constructor falls back to
 * `defaultFormatRegistry` (compliance-service.ts:119) — the module-level singleton built with no
 * rendering port. The EN16931 provider emits real bytes only when that port is present
 * (providers.ts:96-142), so every artifact it rebuilt was zero bytes.
 *
 * Three operations rebuild artifacts through that registry: sendViaChannel() (483),
 * archiveDocument() (724), validate() (738). Production therefore transmitted an empty document,
 * archived nothing, and validated emptiness as valid — the empty-bytes short-circuit answers
 * `okValidation`. F-001, on the live DI path.
 *
 * Nothing pointed at it because an empty artifact fails silently at every stage, and because the
 * EXECUTOR was wired correctly — only the facade was not. Reading the module metadata is enough to
 * pin the wiring, and it costs no Prisma, no Redis and no boot.
 */
import { ComplianceExecutor } from '../../execution/executor';
import { FormatProviderRegistry } from '../../providers/format/registry';
import { ComplianceService } from '../../operations/compliance-service';
import { PrismaComplianceDocumentStore } from '../../persistence/prisma-document-store';
import { ComplianceCoreModule } from '../compliance-core.module';

type ProviderDef = {
  provide?: unknown;
  useFactory?: (...args: unknown[]) => unknown;
  inject?: unknown[];
};

function providerFor(token: unknown): ProviderDef {
  const providers = (Reflect.getMetadata('providers', ComplianceCoreModule) ?? []) as ProviderDef[];
  const found = providers.find((p) => p && typeof p === 'object' && p.provide === token);
  expect(found).toBeDefined();
  return found!;
}

describe('P1-T03a — ComplianceCoreModule wires the rendering port everywhere it is needed', () => {
  it('ComplianceService is injected with a FormatProviderRegistry', () => {
    const def = providerFor(ComplianceService);
    // The regression: this list used to be [store, executor, rangeSource] only.
    expect(def.inject).toContain(FormatProviderRegistry);
  });

  it('the FormatProviderRegistry it receives is the port-carrying one, not the bare singleton', () => {
    const def = providerFor(FormatProviderRegistry);
    // The registry provider takes InvoiceRenderingService — that is what carries the rendering
    // port. A registry registered with no inject would be the empty-bytes singleton again.
    expect(def.inject).toBeDefined();
    expect(def.inject!.length).toBeGreaterThan(0);
  });

  it('ComplianceService actually receives it — the factory passes formats through', () => {
    const def = providerFor(ComplianceService);
    const wired = new FormatProviderRegistry();
    const args = def.inject!.map((token) => {
      if (token === FormatProviderRegistry) return wired;
      if (token === ComplianceExecutor) return new ComplianceExecutor();
      if (token === PrismaComplianceDocumentStore) return {} as unknown;
      return {} as unknown;
    });

    // `formats` is private on ComplianceService, so it is read through a cast rather than widened.
    // The private modifier does not change what the factory did with the argument, and identity is
    // what the assertion is about.
    const service = def.useFactory!(...args) as unknown as Record<string, unknown>;

    // Identity, not shape: a factory that accepted the argument and dropped it on the floor would
    // still pass a `toBeDefined()` check by falling back to defaultFormatRegistry.
    expect(service.formats).toBe(wired);
  });
});
