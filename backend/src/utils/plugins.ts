import 'dotenv/config';

import prisma from '@/prisma/prisma.service';

export interface SigningPluginConfig {
  baseUrl: string;
  apiKey: string;
}

export async function getProviderConfig<T>(name: string) {
  const plugin = await prisma.plugin.findFirst({
    where: {
      isActive: true,
      id: name,
    },
  });

  return plugin?.config as T;
}
