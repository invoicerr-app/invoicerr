import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { generateApiKey, hashApiKey } from '@/utils/api-key';

import { ApiKeyScope, isApiKeyScope } from '@/modules/api-keys/scopes';
import prisma from '@/prisma/prisma.service';

@Injectable()
export class ApiKeysService {
  async create(companyId: string, creatorUserId: string, name: string, scopes: ApiKeyScope[] = []) {
    if (!name?.trim()) {
      throw new BadRequestException('Name is required');
    }

    const unknownScope = scopes.find((scope) => !isApiKeyScope(scope));
    if (unknownScope) {
      throw new BadRequestException(`Unknown scope: ${unknownScope}`);
    }

    const key = generateApiKey();
    const keyHash = hashApiKey(key);

    const apiKey = await prisma.apiKey.create({
      data: {
        name: name.trim(),
        keyPrefix: key.slice(0, 12),
        keyHash,
        userId: creatorUserId,
        companyId,
        scopes,
      },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      key,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      createdAt: apiKey.createdAt,
    };
  }

  async list(companyId: string) {
    const apiKeys = await prisma.apiKey.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });

    return apiKeys.map(({ keyHash, ...apiKey }) => apiKey);
  }

  async revoke(companyId: string, id: string) {
    const apiKey = await prisma.apiKey.findUnique({ where: { id } });
    if (!apiKey || apiKey.companyId !== companyId) {
      throw new NotFoundException('API key not found');
    }

    await prisma.apiKey.delete({ where: { id } });
  }
}
