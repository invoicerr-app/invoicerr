import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '@/prisma/prisma.service';
import type { RequestWithUser } from '@/types/request';
import type { CompanyContext } from '@/types/company-context';

export const SKIP_COMPANY_GUARD_KEY = 'skipCompanyGuard';

/**
 * Guard that validates company access for multi-tenant operations.
 *
 * Extracts companyId from:
 * 1. X-Company-Id header (preferred for API clients)
 * 2. Route parameter :companyId
 * 3. Query parameter ?companyId=
 *
 * Validates that the authenticated user belongs to the company
 * and attaches the CompanyContext to the request.
 */
@Injectable()
export class CompanyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if this route should skip company validation
    const skipCompanyGuard = this.reflector.getAllAndOverride<boolean>(SKIP_COMPANY_GUARD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipCompanyGuard) {
      return true;
    }

    const request = context.switchToHttp().getRequest() as RequestWithUser;
    const user = request.user;

    if (!user) {
      // Let AuthGuard handle unauthenticated requests
      return true;
    }

    // System admins can access any company if they specify one
    // but they still need to specify which company they want to access
    const companyId = this.extractCompanyId(request);

    if (!companyId) {
      // If no companyId specified, try to use user's default company
      const defaultCompany = await this.prisma.userCompany.findFirst({
        where: {
          userId: user.id,
          isDefault: true,
        },
        include: {
          company: true,
        },
      });

      if (defaultCompany) {
        request.companyContext = {
          companyId: defaultCompany.companyId,
          company: defaultCompany.company,
          userCompany: defaultCompany,
          role: defaultCompany.role,
        };
        return true;
      }

      // No default company and no companyId specified
      throw new BadRequestException(
        'Company ID is required. Provide it via X-Company-Id header, route parameter, or query parameter.',
      );
    }

    // Verify company exists
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new BadRequestException('Company not found');
    }

    // System admin has access to all companies
    if (user.isSystemAdmin) {
      // Create a virtual UserCompany for system admin
      request.companyContext = {
        companyId: company.id,
        company,
        userCompany: {
          id: 'system-admin-access',
          userId: user.id,
          companyId: company.id,
          role: 'SYSTEM_ADMIN',
          joinedAt: new Date(),
          isDefault: false,
        },
        role: 'SYSTEM_ADMIN',
      };
      return true;
    }

    // Check if user belongs to the company
    const userCompany = await this.prisma.userCompany.findUnique({
      where: {
        userId_companyId: {
          userId: user.id,
          companyId,
        },
      },
      include: {
        company: true,
      },
    });

    if (!userCompany) {
      throw new ForbiddenException('You do not have access to this company');
    }

    // Attach company context to request
    const companyContext: CompanyContext = {
      companyId: userCompany.companyId,
      company: userCompany.company,
      userCompany,
      role: userCompany.role,
    };

    request.companyContext = companyContext;

    return true;
  }

  private extractCompanyId(request: RequestWithUser): string | undefined {
    // Priority 1: Header
    const headerCompanyId = request.headers['x-company-id'];
    if (headerCompanyId && typeof headerCompanyId === 'string') {
      return headerCompanyId;
    }

    // Priority 2: Route parameter
    if (request.params?.companyId) {
      return request.params.companyId;
    }

    // Priority 3: Query parameter
    if (request.query?.companyId && typeof request.query.companyId === 'string') {
      return request.query.companyId;
    }

    return undefined;
  }
}
