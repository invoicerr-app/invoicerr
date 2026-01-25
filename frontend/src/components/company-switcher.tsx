import { Building2, Check, ChevronsUpDown, PlusCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { useCompany } from '@/contexts/company';

interface CompanySwitcherProps {
  onCreateNew?: () => void;
}

export function CompanySwitcher({ onCreateNew }: CompanySwitcherProps) {
  const { t } = useTranslation();
  const { isMobile } = useSidebar();
  const { companies, activeCompanyId, activeCompany, isLoading, switchCompany } = useCompany();

  // Find active company from list
  const activeCompanyData = companies.find((c) => c.companyId === activeCompanyId);

  if (isLoading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" data-cy="company-switcher-loading">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="grid flex-1 gap-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  // If user has no companies, show prompt to create one
  if (companies.length === 0) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" asChild data-cy="company-switcher-empty">
            <section className="flex items-center gap-2">
              <div className="bg-accent text-accent-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <PlusCircle className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{t('sidebar.company.noCompany')}</span>
                <span className="truncate text-xs">{t('sidebar.company.createNew')}</span>
              </div>
            </section>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  // Always show dropdown when user has companies (allows switching and creating new)
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              data-cy="company-switcher"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="bg-accent text-accent-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <Building2 className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {activeCompany?.name || activeCompanyData?.companyName || t('sidebar.company.noCompany')}
                </span>
                <span className="truncate text-xs">{t('sidebar.company.plan')}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t('sidebar.company.switchCompany')}
            </DropdownMenuLabel>
            {companies.map((company) => (
              <DropdownMenuItem
                key={company.companyId}
                data-cy={`company-option-${company.companyId}`}
                onClick={() => switchCompany(company.companyId)}
                className="cursor-pointer gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-sm border">
                  <Building2 className="size-4 shrink-0" />
                </div>
                <span className="flex-1 truncate">{company.companyName}</span>
                {company.companyId === activeCompanyId && (
                  <Check className="size-4 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-cy="company-create-new"
              className="cursor-pointer gap-2 p-2"
              onClick={() => onCreateNew?.()}
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <PlusCircle className="size-4" />
              </div>
              <span className="text-muted-foreground">{t('sidebar.company.createNew')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
