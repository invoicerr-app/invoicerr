import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';

import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import { SsoRegistrarService } from './sso-registrar.service';
import { SsoDomainStatus, SsoService, UpsertSsoProviderBody } from './sso.service';

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

  // ---------------------------------------------------------------------------
  // Domain ownership claims and their DNS TXT verification
  // ---------------------------------------------------------------------------
  //
  // Every route below is scoped to the caller's ACTIVE company exactly like GET/PUT/DELETE above — the
  // `:id` a caller supplies on verify/delete names a DOMAIN CLAIM, never a company, and `sso.service.ts`
  // matches it against the active company's OWN provider row on every call, so an id belonging to
  // another tenant's claim simply does not exist as far as this company is concerned (404, not 403 —
  // the same "don't confirm it exists elsewhere" posture `verifyDomain`'s conflict message itself
  // holds).

  /**
   * GET /api/company/sso/domains — every domain this company has claimed, verified or not. Readable by
   * any member, matching the plain `GET /api/company/sso` above: nothing here is secret, the record
   * value is meant to be published in PUBLIC DNS by design.
   */
  @Get('domains')
  @ApiOperation({ summary: 'List claimed SSO domains and their verification status' })
  @ApiResponse({ status: 200, description: 'Domain claims' })
  listDomains(@ActiveCompany() companyId: string): Promise<SsoDomainStatus[]> {
    return this.sso.listDomains(companyId);
  }

  /**
   * POST /api/company/sso/domains — claim a domain and mint the DNS TXT record to publish. OWNER/ADMIN
   * only: this is what eventually lets the ANONYMOUS `/api/sso/lookup` route send a stranger's sign-in
   * at this company's IdP, once verified — the same sensitivity level as configuring the provider
   * itself.
   */
  @Post('domains')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Claim an email domain for SSO',
    description:
      'Mints (or re-mints, for an existing unverified claim) a DNS TXT verification token and returns ' +
      'the record name/value to publish.',
  })
  @ApiBody({ schema: { type: 'object', properties: { domain: { type: 'string', example: 'acme.com' } } } })
  @ApiResponse({ status: 201, description: 'Domain claimed' })
  @ApiResponse({ status: 400, description: 'Not a valid bare domain' })
  @ApiResponse({ status: 404, description: 'No SSO provider configured yet for this company' })
  addDomain(@ActiveCompany() companyId: string, @Body() body: { domain?: string }): Promise<SsoDomainStatus> {
    if (!body?.domain) {
      throw new BadRequestException('domain is required.');
    }
    return this.sso.addDomain(companyId, body.domain);
  }

  /**
   * POST /api/company/sso/domains/:id/verify — runs the DNS TXT lookup and, on success, marks the
   * domain verified. Throttled tighter than the instance-wide default (`app.module.ts`'s
   * `ThrottlerModule.forRoot`, 120/min): this route makes an OUTBOUND DNS query against a name derived
   * from caller-chosen input on every call, and a bare-domain input (unlike a full URL) offers little
   * for a generic SSRF-style guard to even inspect — rate limiting the endpoint itself is the
   * containment here, the same reasoning `sso-lookup.controller.ts`'s own narrower-than-default
   * `@Throttle` documents for its own outbound-lookup-shaped route.
   */
  @Post('domains/:id/verify')
  @HttpCode(200)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify a claimed domain via its DNS TXT record' })
  @ApiParam({ name: 'id', type: String, description: 'Domain claim ID' })
  @ApiResponse({ status: 200, description: 'Domain verified' })
  @ApiResponse({ status: 400, description: 'TXT record missing, wrong, or a DNS failure' })
  @ApiResponse({ status: 404, description: 'No such domain claim for this company' })
  @ApiResponse({ status: 409, description: 'Already verified for a different account' })
  verifyDomain(@ActiveCompany() companyId: string, @Param('id') id: string): Promise<SsoDomainStatus> {
    return this.sso.verifyDomain(companyId, id);
  }

  /** DELETE /api/company/sso/domains/:id — removes a domain claim outright. */
  @Delete('domains/:id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({ summary: 'Remove a claimed SSO domain' })
  @ApiParam({ name: 'id', type: String, description: 'Domain claim ID' })
  @ApiResponse({ status: 200, description: 'Domain removed' })
  removeDomain(@ActiveCompany() companyId: string, @Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.sso.removeDomain(companyId, id);
  }
}
