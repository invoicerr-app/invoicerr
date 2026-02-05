import { useEffect, useState } from 'react';

import { Navigate } from 'react-router';
import { authClient } from '@/lib/auth';

export default function LogoutPage() {
  const [isLoggedOut, setIsLoggedOut] = useState(false);

  useEffect(() => {
    authClient.signOut().then(() => {
      setIsLoggedOut(true);
    });
  }, []);

  if (isLoggedOut) {
    return <Navigate to="/auth/sign-in" />;
  }

  return null;
}
