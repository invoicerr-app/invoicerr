import { SignAlgo, SignatureLevel, SigningProvider } from './signing-provider';
import {
  CadesSigningProvider,
  NoSigningProvider,
  PadesSigningProvider,
  TimestampOptions,
  XadesSigningProvider,
} from './providers';
import { NullSigningCredentials, SigningCredentialsPort } from './signing-credentials-port';
import { HttpTsaClient, NullTsaClient } from './tsa-client';

/**
 * Derives TimestampOptions from the process environment (or a test-supplied override map).
 *
 * TSA_URL non-empty → HttpTsaClient + level T (or SIGNATURE_LEVEL if explicitly set).
 * TSA_URL absent    → NullTsaClient  + level BES (offline-safe; byte-identical to prior behaviour).
 *
 * SIGNATURE_LEVEL is only honoured when TSA_URL is also set — without a real TSA client,
 * NullTsaClient always returns null and providers fall through to BES-level output anyway.
 *
 * Exported for unit-testing without mutating process.env.
 */
export function resolveTimestampOptions(
  env: Record<string, string | undefined> = process.env,
): TimestampOptions {
  const tsaUrl = env['TSA_URL']?.trim();
  if (!tsaUrl) {
    return { signatureLevel: 'BES', tsa: new NullTsaClient() };
  }
  const level = (env['SIGNATURE_LEVEL'] as SignatureLevel | undefined) ?? 'T';
  return { signatureLevel: level, tsa: new HttpTsaClient(tsaUrl) };
}

export class SigningProviderRegistry {
  private readonly byAlgo = new Map<SignAlgo, SigningProvider>();

  /**
   * @param providers    Optional explicit provider list (skips env-derived options).
   * @param credentials  Signing credentials port; defaults to NullSigningCredentials.
   * @param env          Environment map; defaults to process.env.
   *                     Pass a plain object in tests to avoid mutating global env.
   */
  constructor(
    providers?: SigningProvider[],
    credentials?: SigningCredentialsPort,
    env: Record<string, string | undefined> = process.env,
  ) {
    const creds = credentials ?? new NullSigningCredentials();
    const tsaOpts = resolveTimestampOptions(env);
    const list = providers ?? [
      new XadesSigningProvider(creds, tsaOpts),
      new CadesSigningProvider(creds, tsaOpts),
      new PadesSigningProvider(creds, tsaOpts),
      new NoSigningProvider(),
    ];
    for (const p of list) this.byAlgo.set(p.algo, p);
  }

  get(algo: SignAlgo): SigningProvider {
    return this.byAlgo.get(algo) ?? this.byAlgo.get('none')!;
  }
}

export const defaultSigningRegistry = new SigningProviderRegistry();
