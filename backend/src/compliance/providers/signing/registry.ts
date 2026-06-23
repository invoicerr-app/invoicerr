import { SignAlgo, SigningProvider } from './signing-provider';
import {
  CadesSigningProvider,
  NoSigningProvider,
  PadesSigningProvider,
  XadesSigningProvider,
} from './providers';

export class SigningProviderRegistry {
  private readonly byAlgo = new Map<SignAlgo, SigningProvider>();

  constructor(providers?: SigningProvider[]) {
    const list = providers ?? [
      new XadesSigningProvider(),
      new CadesSigningProvider(),
      new PadesSigningProvider(),
      new NoSigningProvider(),
    ];
    for (const p of list) this.byAlgo.set(p.algo, p);
  }

  get(algo: SignAlgo): SigningProvider {
    return this.byAlgo.get(algo) ?? this.byAlgo.get('none')!;
  }
}

export const defaultSigningRegistry = new SigningProviderRegistry();
