import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Link, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useInvitations } from '@/hooks/use-user-companies';
import { UserRole } from '@/contexts/company-context';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';

interface InviteUserModalProps {
  trigger?: React.ReactNode;
}

export function InviteUserModal({ trigger }: InviteUserModalProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<UserRole>('USER');
  const [expiresInDays, setExpiresInDays] = useState<string>('7');
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const { createInvitation, isLoading } = useInvitations();

  const handleGenerateCode = async () => {
    const days = expiresInDays === 'never' ? null : parseInt(expiresInDays, 10);
    const invitation = await createInvitation({
      role: selectedRole,
      expiresInDays: days,
    });
    
    if (invitation) {
      setGeneratedCode(invitation.code);
    }
  };

  const handleCopyCode = async () => {
    if (generatedCode) {
      await navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setOpen(false);
    // Reset state after animation
    setTimeout(() => {
      setGeneratedCode(null);
      setSelectedRole('USER');
      setExpiresInDays('7');
      setCopied(false);
    }, 300);
  };

  const roleLabels: Record<UserRole, string> = {
    SUPERADMIN: 'company.roles.SUPERADMIN',
    ADMIN: 'company.roles.ADMIN',
    USER: 'company.roles.USER',
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Users className="h-4 w-4 mr-2" />
            {t('company.invite.button')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('company.invite.title')}</DialogTitle>
          <DialogDescription>
            {t('company.invite.description')}
          </DialogDescription>
        </DialogHeader>

        {!generatedCode ? (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="role">{t('company.invite.roleLabel')}</Label>
              <Select
                value={selectedRole}
                onValueChange={(value: UserRole) => setSelectedRole(value)}
              >
                <SelectTrigger id="role">
                  <SelectValue placeholder={t('company.invite.selectRole')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USER">{t(roleLabels.USER)}</SelectItem>
                  <SelectItem value="ADMIN">{t(roleLabels.ADMIN)}</SelectItem>
                  <SelectItem value="SUPERADMIN">{t(roleLabels.SUPERADMIN)}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('company.invite.roleHelp')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expires">{t('company.invite.expiresLabel')}</Label>
              <Select
                value={expiresInDays}
                onValueChange={setExpiresInDays}
              >
                <SelectTrigger id="expires">
                  <SelectValue placeholder={t('company.invite.selectExpiry')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">{t('company.invite.expiry.1day')}</SelectItem>
                  <SelectItem value="7">{t('company.invite.expiry.7days')}</SelectItem>
                  <SelectItem value="30">{t('company.invite.expiry.30days')}</SelectItem>
                  <SelectItem value="never">{t('company.invite.expiry.never')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button 
              onClick={handleGenerateCode} 
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {t('company.invite.generating')}
                </>
              ) : (
                <>
                  <Link className="h-4 w-4 mr-2" />
                  {t('company.invite.generate')}
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Input
                    value={generatedCode}
                    readOnly
                    className="font-mono text-lg tracking-wider"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={handleCopyCode}
                    className={copied ? 'text-green-600 border-green-600' : ''}
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground mt-2 text-center">
                  {t('company.invite.shareCode')}
                </p>
              </CardContent>
            </Card>

            <div className="bg-muted p-4 rounded-lg">
              <h4 className="font-medium text-sm mb-2">{t('company.invite.instructions.title')}</h4>
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>{t('company.invite.instructions.step1')}</li>
                <li>{t('company.invite.instructions.step2')}</li>
                <li>{t('company.invite.instructions.step3')}</li>
              </ol>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setGeneratedCode(null)}
                className="flex-1"
              >
                {t('company.invite.generateAnother')}
              </Button>
              <Button onClick={handleClose} className="flex-1">
                {t('common.done')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
