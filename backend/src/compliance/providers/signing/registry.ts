import { SignAlgo, SigningProvider } from './signing-provider';
import {
  CadesSigningProvider,
  NoSigningProvider,
  PadesSigningProvider,
  XadesSigningProvider,
} from './providers';
import { NullSigningCredentials, SigningCredentialsPort } from './signing-credentials-port';

export class SigningProviderRegistry {
  private readonly byAlgo = new Map<SignAlgo, SigningProvider>();

  constructor(providers?: SigningProvider[], credentials?: SigningCredentialsPort) {
    const creds = credentials ?? new NullSigningCredentials();
    const list = providers ?? [
      new XadesSigningProvider(creds),
      new CadesSigningProvider(creds),
      new PadesSigningProvider(creds),
      new NoSigningProvider(),
    ];
    for (const p of list) this.byAlgo.set(p.algo, p);
  }

  get(algo: SignAlgo): SigningProvider {
    return this.byAlgo.get(algo) ?? this.byAlgo.get('none')!;
  }
}

export const defaultSigningRegistry = new SigningProviderRegistry();
