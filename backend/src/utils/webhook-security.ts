import * as crypto from 'crypto';

/**
 * Generate a secure random secret for webhook verification.
 * @returns {string} The generated webhook secret.
 */
export function generateWebhookSecret(): string {
    return crypto.randomBytes(32).toString('hex');
}