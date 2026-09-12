import { Body, Controller, Delete, Get, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';

import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import { SsoRegistrarService } from './sso-registrar.service';
import { SsoService, UpsertSsoProviderBody } from './sso.service';

/**
 * Per-company single sign-on — the "SSO" company-settings screen. A large customer registers ITS OWN
 * OIDC provider here, without the operator touching the instance's environment.
 *
 * Scoped to the caller's ACTIVE company (`@ActiveCompany()`) exactly like every other
 * company-settings route in this codebase: the company id is NEVER in the URL. That matters more here
 * than elsewhere — the company id is also the second half of the provider id, so accepting it as a
 * path parameter would let any authenticated caller configure an identity provider for somebody
 * else's company.
 */
@ApiTags('company')
@Controller('company/sso')
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly registrar: SsoRegistrarService,
  ) {}

  /**
   * GET /api/company/sso — what is configured, status only (see `SsoProviderStatus`: never a
   * credential, masked or not), plus the redirect URI the customer must register at their own IdP.
   * Readable by any member: it carries no secret, and the screen itself is hidden from MEMBERs.
   */
  @Get()
  @ApiOperation({
    summary: 'Get the SSO configuration',
    description:
      "Returns this company's SSO provider status (never a credential value) and the redirect URI to " +
      'register at the identity provider. Null when SSO has never been configured.',
  })
  @ApiResponse({ status: 200, description: 'SSO status retrieved' })
  async get(@ActiveCompany() companyId: string) {
    const provider = await this.sso.getStatus(companyId);
    // The redirect URI is useful BEFORE anything is configured — it is what the customer needs in
    // order to create the application at their IdP in the first place — so it is returned either way.
    return { provider, redirectUri: this.sso.redirectUriFor(companyId) };
  }

  /**
   * PUT /api/company/sso — configure or update the provider, then register it with the live
   * better-auth instance so it works immediately, with no restart.
   *
   * The response is status-only (see `sso.service.ts#upsert`) — never an echo of the secret this same
   * request just carried.
   */
  @Put()
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Configure SSO',
    description:
      "Creates or updates this company's OIDC provider. Credentials are encrypted at rest and never " +
      'logged or returned. Takes effect immediately.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        label: { type: 'string', example: 'Acme SSO' },
        discoveryUrl: { type: 'string', example: 'https://idp.acme.com/.well-known/openid-configuration' },
        authorizationUrl: { type: 'string' },
        tokenUrl: { type: 'string' },
        userInfoUrl: { type: 'string' },
        scopes: { type: 'array', items: { type: 'string' }, example: ['openid', 'profile', 'email'] },
        clientId: { type: 'string' },
        clientSecret: { type: 'string' },
        emailDomains: { type: 'array', items: { type: 'string' }, example: ['acme.com'] },
        isActive: { type: 'boolean', default: true },
      },
      required: ['clientId'],
    },
  })
  @ApiResponse({ status: 200, description: 'SSO configured' })
  @ApiResponse({ status: 400, description: 'Missing clientId, or neither a discovery URL nor endpoints' })
  @ApiResponse({ status: 503, description: 'CREDENTIALS_ENCRYPTION_KEY is not configured' })
  async upsert(@ActiveCompany() companyId: string, @Body() body: UpsertSsoProviderBody) {
    const status = await this.sso.upsert(companyId, body);

    // Reflect the new configuration into the running process. A deactivated provider is UNregistered
    // rather than left resolvable: "inactive" has to mean it cannot be used to sign in, not merely
    // that the screen says so.
    if (status.isActive) {
      await this.registrar.register(companyId);
    } else {
      await this.registrar.unregister(companyId);
    }

    return status;
  }

  /** DELETE /api/company/sso — removes the configuration and deregisters the provider immediately. */
  @Delete()
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Remove SSO',
    description: "Deletes this company's SSO configuration and stops accepting sign-ins through it.",
  })
  @ApiResponse({ status: 200, description: 'SSO removed' })
  async remove(@ActiveCompany() companyId: string) {
    const result = await this.sso.remove(companyId);
    await this.registrar.unregister(companyId);
    return result;
  }
}
