import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';

import { CreatedPortalAccess, PortalAccessSummary, PortalTokensService } from './portal-tokens.service';

/**
 * The STAFF-facing half of the client portal — invite a client, see their active invites, revoke
 * one. Ordinary, session-authenticated company routes (the GLOBAL `AuthGuard`/`RolesGuard` apply here
 * exactly as they do to `ClientsController`) scoped by `@ActiveCompany()`, on the same
 * `PortalTokensService` model `ShareLinksService` already sets for a document link. A separate
 * controller/path (`clients/:clientId/portal-access`, not a method bolted onto `ClientsController`)
 * so this feature's staff-facing surface stays fully self-contained in `client-portal/` — nothing
 * outside this module needed to change to add it.
 */
@ApiTags('client-portal')
@Controller('clients/:clientId/portal-access')
export class PortalAccessController {
  constructor(private readonly portalTokensService: PortalTokensService) {}

  @Post()
  @ApiOperation({
    summary: 'Invites a client to the client portal',
    description:
      'Mints a long-lived (30 days), revocable link and, when the client has a `contactEmail` on ' +
      'file, emails it — the response also carries the raw URL, shown and copyable exactly once, the ' +
      'same "shown once" contract a document share link already holds.',
  })
  @ApiParam({ name: 'clientId', type: String })
  @ApiResponse({ status: 201, description: 'Portal access created' })
  @ApiResponse({ status: 404, description: 'Client not found for this company' })
  create(
    @ActiveCompany() companyId: string,
    @Param('clientId') clientId: string,
  ): Promise<CreatedPortalAccess> {
    return this.portalTokensService.create(companyId, clientId);
  }

  @Get()
  @ApiOperation({ summary: "A client's own portal-access history" })
  @ApiParam({ name: 'clientId', type: String })
  @ApiResponse({ status: 200, description: 'Portal access list retrieved' })
  list(
    @ActiveCompany() companyId: string,
    @Param('clientId') clientId: string,
  ): Promise<PortalAccessSummary[]> {
    return this.portalTokensService.list(companyId, clientId);
  }

  @Delete(':tokenId')
  @ApiOperation({ summary: 'Revokes one portal-access link' })
  @ApiParam({ name: 'clientId', type: String })
  @ApiParam({ name: 'tokenId', type: String })
  @ApiResponse({ status: 200, description: 'Revoked' })
  @ApiResponse({ status: 404, description: 'Not found for this client' })
  revoke(
    @ActiveCompany() companyId: string,
    @Param('clientId') clientId: string,
    @Param('tokenId') tokenId: string,
  ): Promise<{ revoked: true }> {
    return this.portalTokensService.revoke(companyId, clientId, tokenId);
  }

  @Delete()
  @ApiOperation({
    summary: 'Revokes EVERY active portal-access link for this client',
    description:
      'A single "cut off portal access entirely" call — e.g. a leaked link — rather than revoking ' +
      'each active invite one by one.',
  })
  @ApiParam({ name: 'clientId', type: String })
  @ApiResponse({ status: 200, description: 'Revoked' })
  @ApiResponse({ status: 404, description: 'Client not found for this company' })
  revokeAll(
    @ActiveCompany() companyId: string,
    @Param('clientId') clientId: string,
  ): Promise<{ revoked: true }> {
    return this.portalTokensService.revokeAll(companyId, clientId);
  }
}
