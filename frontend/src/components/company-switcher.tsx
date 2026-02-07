import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { UserCompany, UserRole, useCompany } from '@/contexts/company-context';
import { Company } from '@/types';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';

interface CompanySwitcherProps {
  currentCompany: Company | null;
  userCompanies: UserCompany[];
  onSwitch: (companyId: string) => Promise<void>;
  isLoading?: boolean;
}

const roleColors: Record<UserRole, string> = {
  SUPERADMIN: 'bg-purple-100 text-purple-700 border-purple-200',
  ADMIN: 'bg-blue-100 text-blue-700 border-blue-200',
  USER: 'bg-gray-100 text-gray-700 border-gray-200',
};

const roleLabels: Record<UserRole, string> = {
  SUPERADMIN: 'company.roles.SUPERADMIN',
  ADMIN: 'company.roles.ADMIN',
  USER: 'company.roles.USER',
};

export function CompanySwitcher({
  currentCompany,
  userCompanies,
  onSwitch,
  isLoading = false,
}: CompanySwitcherProps) {
  const { t } = useTranslation();
  const { createCompany } = useCompany();
  const isMobile = useIsMobile();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateCompany = async () => {
    if (!newCompanyName.trim()) {
      toast.error('Please enter a company name');
      return;
    }

    setIsCreating(true);
    try {
      const company = await createCompany(newCompanyName.trim());
      if (company) {
        setNewCompanyName('');
        setIsDialogOpen(false);
      }
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-2 py-2">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <div className="flex-1 space-y-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2 w-16" />
        </div>
      </div>
    );
  }

  const currentUserCompany = userCompanies.find(
    uc => uc.companyId === currentCompany?.id || uc.company.id === currentCompany?.id
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <div className="bg-accent text-accent-foreground flex aspect-square size-8 items-center justify-center rounded-lg mr-2">
            <Building2 className="size-4" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{currentCompany?.name || t('sidebar.company.noCompany')}</span>
            <div className="flex items-center gap-2">
              {currentUserCompany?.role && (
                <Badge variant="outline" className={`text-[10px] px-1 py-0 ${roleColors[currentUserCompany.role]}`}>
                  {t(roleLabels[currentUserCompany.role])}
                </Badge>
              )}
            </div>
          </div>
          <ChevronsUpDown className="ml-auto size-4" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-64 rounded-lg mt-2"
        side={isMobile ? "bottom" : "right"}
        align="end"
        sideOffset={12}
      >
        <DropdownMenuLabel>{t('company.switcher.title')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {userCompanies.length === 0 ? (
          <DropdownMenuItem disabled>
            <span className="text-muted-foreground">{t('sidebar.company.noCompany')}</span>
          </DropdownMenuItem>
        ) : (
          userCompanies.map((userCompany) => {
            const isActive = userCompany.companyId === currentCompany?.id || userCompany.company.id === currentCompany?.id;
            return (
              <DropdownMenuItem
                key={userCompany.companyId}
                onClick={() => onSwitch(userCompany.companyId)}
                className="cursor-pointer"
                disabled={isActive}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex flex-col">
                    <span className="font-medium">{userCompany.company.name}</span>
                    <Badge variant="outline" className={`text-[10px] px-1 py-0 w-fit mt-1 ${roleColors[userCompany.role]}`}>
                      {t(roleLabels[userCompany.role])}
                    </Badge>
                  </div>
                  {isActive && (
                    <Check className="size-4 text-primary" />
                  )}
                </div>
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={(e) => e.preventDefault()}
            >
              <Plus className="size-4 mr-2" />
              {t('sidebar.company.createNew')}
            </DropdownMenuItem>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('sidebar.company.createNew')}</DialogTitle>
              <DialogDescription>
                {t('sidebar.company.createDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input
                placeholder={t('sidebar.company.namePlaceholder')}
                value={newCompanyName}
                onChange={(e) => setNewCompanyName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateCompany();
                  }
                }}
                disabled={isCreating}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
                disabled={isCreating}
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleCreateCompany}
                disabled={isCreating || !newCompanyName.trim()}
              >
                {isCreating ? t('common.creating') : t('common.create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
