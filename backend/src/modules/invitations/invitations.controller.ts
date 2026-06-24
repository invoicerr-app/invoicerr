import {
    Controller,
    Get,
    Post,
    Delete,
    Body,
    Param,
    Query,
    BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InvitationsService } from './invitations.service';
import { User } from '@/decorators/user.decorator';
import { CurrentUser } from '@/types/user';
import { Public } from '@thallesp/nestjs-better-auth';
import { pendingInvitationCodes } from '@/lib/auth';

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
    constructor(private readonly invitationsService: InvitationsService) { }

    @Get('can-register')
    @Public()
    @ApiOperation({ summary: 'Check if registration is allowed', description: 'Checks whether a given invitation code is valid and allows registration (public).' })
    @ApiQuery({ name: 'code', required: false, type: String, description: 'Invitation code to validate' })
    @ApiResponse({ status: 200, description: 'Registration status retrieved' })
    async canRegister(@Query('code') code?: string) {
        return this.invitationsService.canRegister(code);
    }

    @Get('is-first-user')
    @Public()
    @ApiOperation({ summary: 'Check if this is the first user', description: 'Returns whether any user has been registered yet (public).' })
    @ApiResponse({ status: 200, description: 'First user status retrieved' })
    async isFirstUser() {
        const isFirst = await this.invitationsService.isFirstUser();
        return { isFirstUser: isFirst };
    }

    @Post('validate')
    @Public()
    @ApiOperation({ summary: 'Validate an invitation code', description: 'Validates an invitation code and email pair, storing the code for the registration flow (public).' })
    @ApiResponse({ status: 201, description: 'Invitation code validated' })
    async validateInvitation(
        @Body() body: { code: string; email: string },
    ) {
        if (!body.code || !body.email) {
            throw new BadRequestException('Code and email are required');
        }

        const result = await this.invitationsService.canRegister(body.code);

        if (!result.allowed) {
            throw new BadRequestException(result.message || 'Invalid invitation code');
        }

        pendingInvitationCodes.set(body.email.toLowerCase(), body.code);

        return { valid: true, message: 'Invitation code validated' };
    }

    @Post()
    @ApiOperation({ summary: 'Create an invitation', description: 'Generates a new invitation link/code for inviting a user to the company.' })
    @ApiResponse({ status: 201, description: 'Invitation created' })
    async createInvitation(
        @User() user: CurrentUser,
        @Body() body: { expiresInDays?: number },
    ) {
        return this.invitationsService.createInvitation(
            user.id,
            body.expiresInDays,
        );
    }

    @Get()
    @ApiOperation({ summary: 'List invitations', description: 'Returns all pending invitations created by the current user.' })
    @ApiResponse({ status: 200, description: 'Invitations retrieved' })
    async listInvitations(@User() user: CurrentUser) {
        return this.invitationsService.listInvitations(user.id);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete an invitation', description: 'Revokes a pending invitation by its ID.' })
    @ApiParam({ name: 'id', type: String, description: 'Invitation ID' })
    @ApiResponse({ status: 200, description: 'Invitation deleted' })
    async deleteInvitation(
        @Param('id') id: string,
        @User() user: CurrentUser,
    ) {
        return this.invitationsService.deleteInvitation(id, user.id);
    }
}
