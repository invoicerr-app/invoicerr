import { ChannelEnvironment } from '../../../prisma/generated/prisma/client';

/** Coerce an untrusted string to ChannelEnvironment, defaulting to TEST. Shared by the channel
 *  credentials and the signing certificates services. */
export function toChannelEnvironment(value: string | undefined): ChannelEnvironment {
  if (value === ChannelEnvironment.PROD) return ChannelEnvironment.PROD;
  return ChannelEnvironment.TEST;
}
