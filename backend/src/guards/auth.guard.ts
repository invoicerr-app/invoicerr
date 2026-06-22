import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { extractApiKey, hashApiKey } from '@/utils/api-key';

import { Reflector } from '@nestjs/core';
import { auth } from '@/lib/auth';
import { fromNodeHeaders } from 'better-auth/node';
import prisma from '@/prisma/prisma.service';

// Use the same metadata key as @thallesp/nestjs-better-auth
const IS_PUBLIC_KEY = 'PUBLIC';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const headers = fromNodeHeaders(request.headers);

    const session = await auth.api.getSession({
      headers,
    });

    if (session) {
      request.user = session.user;
      request.session = session.session;
      return true;
    }

    const rawKey = extractApiKey(request.headers);
    if (rawKey) {
      const apiKey = await prisma.apiKey.findUnique({
        where: { keyHash: hashApiKey(rawKey) },
        include: { user: true },
      });

      if (apiKey) {
        prisma.apiKey.update({
          where: { id: apiKey.id },
          data: { lastUsedAt: new Date() },
        }).catch(() => undefined);

        request.user = apiKey.user;
        return true;
      }
    }

    throw new UnauthorizedException();
  }
}
