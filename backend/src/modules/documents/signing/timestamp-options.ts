import { TimestampOptions } from './providers';
import { SignatureLevel } from './signing-provider';
import { HttpTsaClient, NullTsaClient } from './tsa-client';

/**
 * Derives TimestampOptions from the process environment (or a test-supplied override map) -
 * reprised verbatim from the reference.
 *
 * TSA_URL non-empty → HttpTsaClient + level T (or SIGNATURE_LEVEL if explicitly set).
 * TSA_URL absent    → NullTsaClient  + level BES (offline-safe; byte-identical to prior behaviour).
 *
 * SIGNATURE_LEVEL is only honoured when TSA_URL is also set - without a real TSA client,
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
