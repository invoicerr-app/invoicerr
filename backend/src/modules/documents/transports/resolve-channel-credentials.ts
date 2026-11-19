import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';

/**
 * This company's active channel config for `providerId`, parsed by `parse`, or `null` when the channel
 * is not connected or `parse` rejects its config as incomplete. Each caller keeps its own "not
 * connected" handling (log line, exception class and message).
 */
export async function resolveChannelCredentials<T>(
  svc: Pick<ChannelCredentialsService, 'resolveActive'>,
  companyId: string,
  providerId: string,
  parse: (resolved: ResolvedChannelConfig) => T | null,
): Promise<T | null> {
  const resolved = await svc.resolveActive(companyId, providerId);
  return resolved ? parse(resolved) : null;
}
