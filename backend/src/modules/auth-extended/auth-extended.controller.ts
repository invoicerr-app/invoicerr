import { Body, Controller, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { auth } from '@/lib/auth';

@Controller('auth-extended')
export class AuthExtendedController {
    @Post('set-password')
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
