import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '@/lib/auth';
import { PrismaService } from '@/prisma/prisma.service';

// Use the same metadata key as @thallesp/nestjs-better-auth
const IS_PUBLIC_KEY = 'PUBLIC';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

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

    if (!session) {
      throw new UnauthorizedException();
    }

    // Fetch user with multi-tenant information
    const userWithCompanies = await this.prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        companies: {
          include: {
            company: true,
          },
        },
      },
    });

    request.user = {
      ...session.user,
      isSystemAdmin: userWithCompanies?.isSystemAdmin ?? false,
      companies: userWithCompanies?.companies ?? [],
    };
    request.session = session.session;

    return true;
  }
}
