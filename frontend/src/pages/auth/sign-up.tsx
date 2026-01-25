import { Building2, EyeClosedIcon, EyeIcon, TicketIcon } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth';

type SignupFormData = {
  firstname: string;
  lastname: string;
  email: string;
  password: string;
  invitationCode?: string;
};

interface InvitationInfo {
  companyId: string;
  companyName: string;
  role: string;
}

export default function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [errors, setErrors] = useState<Partial<Record<keyof SignupFormData, string[]>>>({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [requiresInvitation, setRequiresInvitation] = useState<boolean | null>(null);
  const [checkingInvitation, setCheckingInvitation] = useState(true);
  const [invitationCode, setInvitationCode] = useState<string>('');
  const [invitationInfo, setInvitationInfo] = useState<InvitationInfo | null>(null);

  const getEnvVariable = (key: string): string | undefined => {
    return (window as any).__APP_CONFIG__?.[key] || import.meta.env[key];
  };

  const backendUrl = getEnvVariable('VITE_BACKEND_URL') || '';

  // Read invitation code from URL query param
  useEffect(() => {
    const codeFromUrl = searchParams.get('invitation');
    if (codeFromUrl) {
      setInvitationCode(codeFromUrl);
      // Validate and fetch invitation details
      fetchInvitationDetails(codeFromUrl);
    }
  }, [searchParams]);

  const fetchInvitationDetails = async (code: string) => {
    try {
      const response = await fetch(`${backendUrl}/api/invitations/can-register?code=${encodeURIComponent(code)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.allowed && data.companyName) {
          setInvitationInfo({
            companyId: data.companyId,
            companyName: data.companyName,
            role: data.role,
          });
        }
      }
    } catch (error) {
      console.error('Error fetching invitation details:', error);
    }
  };

  // Check if invitation is required on page load
  useEffect(() => {
    const checkInvitationRequired = async () => {
      try {
        const response = await fetch(`${backendUrl}/api/invitations/is-first-user`);
        const data = await response.json();
        setRequiresInvitation(!data.isFirstUser);
      } catch (error) {
        console.error('Error checking invitation requirement:', error);
        // Default to requiring invitation on error for security
        setRequiresInvitation(true);
      } finally {
        setCheckingInvitation(false);
      }
    };

    checkInvitationRequired();
  }, [backendUrl]);

  const validateInvitationCode = async (code: string, email: string): Promise<boolean> => {
    try {
      const response = await fetch(`${backendUrl}/api/invitations/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, email }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || t('auth.signup.errors.invalidInvitationCode'));
      }

      return true;
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      }
      return false;
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors({});

    const formData = new FormData(event.currentTarget);
    const data: SignupFormData = {
      firstname: formData.get('firstname') as string,
      lastname: formData.get('lastname') as string,
      email: formData.get('email') as string,
      password: formData.get('password') as string,
      invitationCode: formData.get('invitationCode') as string,
    };

    // Validate invitation code if required
    if (requiresInvitation) {
      if (!data.invitationCode) {
        setErrors({ invitationCode: [t('auth.signup.errors.invitationCodeRequired')] });
        return;
      }

      setLoading(true);
      const isValid = await validateInvitationCode(data.invitationCode, data.email);
      if (!isValid) {
        setLoading(false);
        return;
      }
    } else {
      setLoading(true);
    }

    const result = await authClient.signUp.email({
      email: data.email,
      password: data.password,
      // @ts-expect-error additional fields
      firstname: data.firstname,
      lastname: data.lastname,
    });

    setLoading(false);

    if (result.error) {
      toast.error(result.error.message || t('auth.signup.errors.genericError'));
    }

    if (result.data?.user.createdAt) {
      toast.success(t('auth.signup.messages.accountCreated'));
      setTimeout(() => {
        navigate('/auth/sign-in');
      }, 1000);
    }
  };

  const handleOIDCLogin = () => {
    const oidcProviderId = getEnvVariable('VITE_OIDC_PROVIDER_ID');

    authClient.signIn.oauth2({
      providerId: oidcProviderId || 'oidc',
      callbackURL: '/dashboard',
    });
  };

  if (checkingInvitation) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">{t('auth.signup.title')}</CardTitle>
          <CardDescription className="text-center">{t('auth.signup.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstname">{t('auth.signup.form.firstname.label')}</Label>
                <Input
                  id="firstname"
                  name="firstname"
                  placeholder={t('auth.signup.form.firstname.placeholder')}
                  disabled={loading}
                  data-cy="auth-firstname-input"
                />
                {errors.firstname && <p className="text-sm text-red-600">{errors.firstname[0]}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastname">{t('auth.signup.form.lastname.label')}</Label>
                <Input
                  id="lastname"
                  name="lastname"
                  placeholder={t('auth.signup.form.lastname.placeholder')}
                  disabled={loading}
                  data-cy="auth-lastname-input"
                />
                {errors.lastname && <p className="text-sm text-red-600">{errors.lastname[0]}</p>}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.signup.form.email.label')}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder={t('auth.signup.form.email.placeholder')}
                disabled={loading}
                data-cy="auth-email-input"
              />
              {errors.email && <p className="text-sm text-red-600">{errors.email[0]}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.signup.form.password.label')}</Label>

              <div className="flex items-center justify-between gap-2">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={t('auth.signup.form.password.placeholder')}
                  disabled={loading}
                  data-cy="auth-password-input"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? (
                    <EyeClosedIcon className="h-4 w-4" />
                  ) : (
                    <EyeIcon className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {errors.password && (
                <div className="space-y-1">
                  <p className="text-sm text-red-600">
                    {t('auth.signup.form.password.requirements')}
                  </p>
                  <ul className="text-sm text-red-600 list-disc list-inside">
                    {errors.password.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {requiresInvitation && (
              <div className="space-y-2">
                <Label htmlFor="invitationCode">{t('auth.signup.form.invitationCode.label')}</Label>
                <div className="flex items-center gap-2">
                  <TicketIcon className="h-4 w-4 text-muted-foreground" />
                  <Input
                    id="invitationCode"
                    name="invitationCode"
                    placeholder={t('auth.signup.form.invitationCode.placeholder')}
                    disabled={loading}
                    className="font-mono uppercase"
                    data-cy="auth-invitation-code-input"
                    value={invitationCode}
                    onChange={(e) => {
                      setInvitationCode(e.target.value);
                      setInvitationInfo(null);
                    }}
                    onBlur={(e) => {
                      if (e.target.value && e.target.value !== invitationCode) {
                        fetchInvitationDetails(e.target.value);
                      }
                    }}
                  />
                </div>
                {invitationInfo ? (
                  <div className="flex items-center gap-2 p-2 rounded-md bg-primary/10 text-sm">
                    <Building2 className="h-4 w-4 text-primary" />
                    <span>
                      {t('auth.signup.form.invitationCode.joiningCompany', {
                        companyName: invitationInfo.companyName,
                        defaultValue: `You will join: ${invitationInfo.companyName}`,
                      })}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('auth.signup.form.invitationCode.hint')}
                  </p>
                )}
                {errors.invitationCode && (
                  <p className="text-sm text-red-600">{errors.invitationCode[0]}</p>
                )}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading} data-cy="auth-submit-btn">
              {loading ? t('auth.signup.form.creatingAccount') : t('auth.signup.form.createButton')}
            </Button>
          </form>
          <section className="flex flex-col mt-4 gap-1">
            <div className="text-center text-sm">
              {t('auth.signup.hasAccount')}{' '}
              <a
                href="/auth/sign-in"
                className="underline hover:text-primary cursor-pointer"
                data-cy="auth-signin-link"
              >
                {t('auth.signup.signInLink')}
              </a>
            </div>
            {getEnvVariable('VITE_OIDC_PROVIDER_ID') && (
              <div className="text-center text-sm">
                {t('auth.login.oidc')}{' '}
                <Button
                  variant="link"
                  onClick={handleOIDCLogin}
                  className="underline hover:text-primary p-0"
                >
                  {t('auth.login.oidcLink')}
                </Button>
              </div>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
