import { Body, Controller, ForbiddenException, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { auth } from '@/lib/auth';
import { isOidcOnly } from '@/lib/sso-policy';

@ApiTags('auth-extended')
@Controller('auth-extended')
export class AuthExtendedController {
  @Post('set-password')
  @ApiOperation({
    summary: 'Set a password',
    description:
      'Sets a password for the current user (e.g. for OIDC-only accounts that have never had one).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        newPassword: { type: 'string', minLength: 8, description: 'New password, at least 8 characters' },
      },
      required: ['newPassword'],
    },
  })
  @ApiResponse({ status: 201, description: 'Password set successfully' })
  @ApiResponse({ status: 401, description: 'Failed to set password' })
  @ApiResponse({ status: 403, description: 'This instance is single-sign-on only (OIDC_ONLY)' })
  async setPassword(@Req() req: Request, @Body() body: { newPassword: string }) {
    // better-auth does NOT gate `setPassword`/`changePassword` behind `emailAndPassword.enabled`, so
    // on an OIDC_ONLY instance a signed-in user could still mint themselves a password here and walk
    // back in through the door the operator believed was shut — the flag would be cosmetic. Refused
    // explicitly, server-side: hiding the card in the UI is a convenience, never the control.
    if (isOidcOnly()) {
      throw new ForbiddenException(
        'This instance is configured for single sign-on only (OIDC_ONLY); passwords are disabled.',
      );
    }

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
