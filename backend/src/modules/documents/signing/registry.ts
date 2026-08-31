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
 * Derives TimestampOptions from the process environment (or a test-supplied override map) —
 * reprised verbatim from the repère.
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
  const tsaUrl = env.TSA_URL?.trim();
  if (!tsaUrl) {
    return { signatureLevel: 'BES', tsa: new NullTsaClient() };
  }
  const level = (env.SIGNATURE_LEVEL as SignatureLevel | undefined) ?? 'T';
  return { signatureLevel: level, tsa: new HttpTsaClient(tsaUrl) };
}

/**
 * Registry of signing providers by algorithm — reprised verbatim from the repère
 * (`compliance/providers/signing/registry.ts`).
 *
 * Only PAdES is wired to a live flow today (`rendering/sign-instance-pdf.ts`, root TODO item 13): no
 * jurisdiction this product ships requires us to prove a document SIGNATURE — PDP Factur-X does not
 * require one, KSeF authenticates by session token not a document signature, and SdI accepts CAdES
 * but that channel has no accreditation yet (TODO.md item 10's own `sdi-transport.ts` header). XAdES
 * and CAdES are registered here, tested (`providers.spec.ts`), and ready — so the capability exists
 * the moment a real obligation is sourced (`content-requirements/`-style, never invented) — but
 * nothing in this codebase calls `registry.get('XAdES' | 'CAdES')` outside their own specs.
 */
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
