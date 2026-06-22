import { Body, Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { auth } from '@/lib/auth';

@ApiTags('auth-extended')
@Controller('auth-extended')
export class AuthExtendedController {
    @Post('set-password')
    @ApiOperation({ summary: 'Set a password', description: 'Sets a password for the current user (e.g. for OIDC-only accounts that have never had one).' })
    @ApiBody({ schema: { type: 'object', properties: { newPassword: { type: 'string', minLength: 8, description: 'New password, at least 8 characters' } }, required: ['newPassword'] } })
    @ApiResponse({ status: 201, description: 'Password set successfully' })
    @ApiResponse({ status: 401, description: 'Failed to set password' })
    async setPassword(
        @Req() req: Request,
        @Body() body: { newPassword: string },
    ) {
        if (!body.newPassword || body.newPassword.length < 8) {
            throw new UnauthorizedException('Password must be at least 8 characters');
        }

        try {
            await auth.api.setPassword({
                body: { newPassword: body.newPassword },
                headers: req.headers as any,
            });
            return { success: true, message: 'Password set successfully' };
        } catch (error) {
            console.error('Error setting password:', error);
            throw new UnauthorizedException('Failed to set password');
        }
    }
}
