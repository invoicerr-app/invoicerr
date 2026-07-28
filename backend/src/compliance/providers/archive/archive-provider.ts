import { ArchivalPolicy } from '../../profiles/schema';
import { ComplianceLogger } from '../../execution/logger';
import { ArchiveReceipt, SignedArtifact } from '../../execution/types';

/** Stores the authoritative artifact with retention + residency + (optional) WORM semantics (§10). */
export interface ArchiveProvider {
  readonly id: string;
  readonly regions: string[]; // e.g. ['MX'], ['EU'], ['GLOBAL']
  store(artifacts: SignedArtifact[], policy: ArchivalPolicy, log: ComplianceLogger): ArchiveReceipt;
}
