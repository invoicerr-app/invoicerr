import { ComplianceLogger } from '../../execution/logger';
import { RenderedArtifact, SignedArtifact } from '../../execution/types';
import { SignAlgo, SigningProvider } from './signing-provider';

export class XadesSigningProvider implements SigningProvider {
  readonly algo: SignAlgo = 'XAdES';
  sign(rendered: RenderedArtifact, certRef: string, log: ComplianceLogger): SignedArtifact {
    log.todo('signing/xades', `XAdES-sign ${rendered.syntax} with cert "${certRef}"`);
    return { ...rendered, signature: { algo: 'XAdES', certRef } };
  }
}

export class CadesSigningProvider implements SigningProvider {
  readonly algo: SignAlgo = 'CAdES';
  sign(rendered: RenderedArtifact, certRef: string, log: ComplianceLogger): SignedArtifact {
    log.todo('signing/cades', `CAdES-sign ${rendered.syntax} with cert "${certRef}"`);
    return { ...rendered, signature: { algo: 'CAdES', certRef } };
  }
}

export class PadesSigningProvider implements SigningProvider {
  readonly algo: SignAlgo = 'PAdES';
  sign(rendered: RenderedArtifact, certRef: string, log: ComplianceLogger): SignedArtifact {
    log.todo('signing/pades', `PAdES-sign ${rendered.syntax} with cert "${certRef}"`);
    return { ...rendered, signature: { algo: 'PAdES', certRef } };
  }
}

/** No-op signer for post-audit / non-signed regimes (still a first-class provider). */
export class NoSigningProvider implements SigningProvider {
  readonly algo: SignAlgo = 'none';
  sign(rendered: RenderedArtifact): SignedArtifact {
    return { ...rendered };
  }
}
