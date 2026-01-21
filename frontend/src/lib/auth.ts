import { genericOAuthClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BACKEND_URL || '',
  additionalFields: {
    firstname: '',
    lastname: '',
  },
  plugins: [genericOAuthClient()],
});
