import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { generateApiKey, hashApiKey } from '@/utils/api-key';

import prisma from '@/prisma/prisma.service';

@Injectable()
export class ApiKeysService {
  async create(userId: string, name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('Name is required');
    }

    const key = generateApiKey();
    const keyHash = hashApiKey(key);

    const apiKey = await prisma.apiKey.create({
      data: {
        name: name.trim(),
        keyPrefix: key.slice(0, 12),
        keyHash,
        userId,
      },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      key,
      keyPrefix: apiKey.keyPrefix,
      createdAt: apiKey.createdAt,
    };
  }

  async list(userId: string) {
    const apiKeys = await prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return apiKeys.map(({ keyHash, ...apiKey }) => apiKey);
  }

  async revoke(userId: string, id: string) {
    const apiKey = await prisma.apiKey.findUnique({ where: { id } });
    if (!apiKey || apiKey.userId !== userId) {
      throw new NotFoundException('API key not found');
    }

    await prisma.apiKey.delete({ where: { id } });
  }
}
