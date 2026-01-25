import { Building2, CheckCircle, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authClient } from '@/lib/auth';
import type { CompanyInvitation, CompanyRole } from '@/types';

type InvitationState = 'loading' | 'valid' | 'expired' | 'invalid' | 'already-member';

export default function InvitationPage() {
  const { t } = useTranslation();
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const { data: session, isPending: sessionLoading } = authClient.useSession();

  const [state, setState] = useState<InvitationState>('loading');
  const [invitation, setInvitation] = useState<CompanyInvitation | null>(null);
  const [accepting, setAccepting] = useState(false);

  const backendUrl = import.meta.env.VITE_BACKEND_URL || '';

  // Fetch invitation details
  useEffect(() => {
    if (!code) {
      setState('invalid');
      return;
    }

    const fetchInvitation = async () => {
      try {
        const response = await fetch(`${backendUrl}/api/invitations/code/${encodeURIComponent(code)}`);
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          if (response.status === 404 || data.message?.includes('not found')) {
            setState('invalid');
          } else if (response.status === 410 || data.message?.includes('expired')) {
            setState('expired');
          } else if (data.message?.includes('already been used')) {
            setState('invalid');
          } else {
            setState('invalid');
          }
          return;
        }

        const data = await response.json();
        setInvitation(data);
        setState('valid');
      } catch (error) {
        console.error('Error fetching invitation:', error);
        setState('invalid');
      }
    };

    fetchInvitation();
  }, [code, backendUrl]);

  const handleAccept = async () => {
    if (!code) return;

    setAccepting(true);
    try {
      const response = await fetch(`${backendUrl}/api/invitations/code/${encodeURIComponent(code)}/accept`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 409) {
          setState('already-member');
          return;
        }
        throw new Error(error.message || 'Failed to accept invitation');
      }

      const result = await response.json();
      toast.success(t('companyInvitation.messages.accepted', { companyName: invitation?.companyName }));

      // Store the new company as active
      localStorage.setItem('invoicerr_active_company_id', result.companyId);

      // Redirect to dashboard
      navigate('/dashboard');
    } catch (error) {
      console.error('Error accepting invitation:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to accept invitation');
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = () => {
    toast.info(t('companyInvitation.messages.declined'));
    navigate('/');
  };

  const handleSignUp = () => {
    // Redirect to signup with invitation code
    navigate(`/auth/sign-up?invitation=${code}`);
  };

  const getRoleLabel = (role: CompanyRole) => {
    return t(`companyInvitation.roles.${role}`);
  };

  // Show loading while checking session or fetching invitation
  if (sessionLoading || state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Invalid invitation
  if (state === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <XCircle className="h-6 w-6 text-red-600" />
            </div>
            <CardTitle>{t('companyInvitation.messages.invalid')}</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate('/')} variant="outline">
              {t('common.cancel')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Expired invitation
  if (state === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
              <XCircle className="h-6 w-6 text-amber-600" />
            </div>
            <CardTitle>{t('companyInvitation.messages.expired')}</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate('/')} variant="outline">
              {t('common.cancel')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Already a member
  if (state === 'already-member') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
              <CheckCircle className="h-6 w-6 text-blue-600" />
            </div>
            <CardTitle>{t('companyInvitation.messages.alreadyMember')}</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate('/dashboard')}>
              {t('sidebar.navigation.dashboard')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Valid invitation - show details
  return (
    <div className="min-h-screen flex items-center justify-center p-4" data-cy="invitation-page">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>{t('companyInvitation.title')}</CardTitle>
          <CardDescription>{t('companyInvitation.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {invitation && (
            <div className="space-y-4">
              <div className="rounded-lg border p-4 space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">{t('companyInvitation.companyName')}</p>
                  <p className="font-medium">{invitation.companyName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('companyInvitation.role')}</p>
                  <p className="font-medium">{getRoleLabel(invitation.role)}</p>
                </div>
                {invitation.invitedBy && (
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t('companyInvitation.invitedBy', {
                        name: `${invitation.invitedBy.firstname} ${invitation.invitedBy.lastname}`,
                      })}
                    </p>
                  </div>
                )}
              </div>

              {session ? (
                // User is logged in - show accept/decline buttons
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={handleDecline}
                    disabled={accepting}
                    data-cy="invitation-decline-btn"
                  >
                    {t('companyInvitation.actions.decline')}
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={handleAccept}
                    disabled={accepting}
                    data-cy="invitation-accept-btn"
                  >
                    {accepting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('companyInvitation.actions.accepting')}
                      </>
                    ) : (
                      t('companyInvitation.actions.accept')
                    )}
                  </Button>
                </div>
              ) : (
                // User is not logged in - show sign up prompt
                <div className="space-y-4">
                  <div className="rounded-lg bg-muted p-4 text-center">
                    <p className="text-sm font-medium">{t('companyInvitation.signupRequired.title')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('companyInvitation.signupRequired.description')}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => navigate('/auth/sign-in')}>
                      {t('auth.signup.signInLink')}
                    </Button>
                    <Button className="flex-1" onClick={handleSignUp}>
                      {t('auth.login.signUpLink')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
