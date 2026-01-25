import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@radix-ui/react-dropdown-menu';
import {
  ChevronsUpDown,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Moon,
  Receipt,
  ReceiptText,
  Settings,
  Shield,
  Sun,
  TrendingUp,
  User,
  Users,
} from 'lucide-react';
import { CompanySwitcher } from './company-switcher';
import { useCompany } from '@/contexts/company';
import type React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar as RootSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { authClient } from '@/lib/auth';
import OnBoarding from './onboarding';
import { useTheme } from './theme-provider';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';

export function Sidebar() {
  const { t } = useTranslation();
  const { open: isOpen } = useSidebar();
  const isMobile = useIsMobile();
  const location = useLocation();

  const { data, isPending: userLoading } = authClient.useSession();
  const { activeCompany, isLoading: companyLoading } = useCompany();
  const [showCreateCompanyModal, setShowCreateCompanyModal] = useState(false);

  const { setTheme } = useTheme();
  const navigate = useNavigate();

  const items: { title: string; icon: React.ReactNode; url: string; dataCy: string }[] = [
    {
      title: t('sidebar.navigation.dashboard'),
      icon: <LayoutDashboard className="w-4 h-4" />,
      url: '/dashboard',
      dataCy: 'sidebar-dashboard-link',
    },
    {
      title: t('sidebar.navigation.quotes'),
      icon: <FileText className="w-4 h-4" />,
      url: '/quotes',
      dataCy: 'sidebar-quotes-link',
    },
    {
      title: t('sidebar.navigation.invoices'),
      icon: <ReceiptText className="w-4 h-4" />,
      url: '/invoices',
      dataCy: 'sidebar-invoices-link',
    },
    {
      title: t('sidebar.navigation.receipts'),
      icon: <Receipt className="w-4 h-4" />,
      url: '/receipts',
      dataCy: 'sidebar-receipts-link',
    },
    {
      title: t('sidebar.navigation.clients'),
      icon: <Users className="w-4 h-4" />,
      url: '/clients',
      dataCy: 'sidebar-clients-link',
    },
    {
      title: t('sidebar.navigation.paymentMethods'),
      icon: <CreditCard className="w-4 h-4" />,
      url: '/payment-methods',
      dataCy: 'sidebar-payment-methods-link',
    },
    {
      title: t('sidebar.navigation.stats'),
      icon: <TrendingUp className="w-4 h-4" />,
      url: '/stats',
      dataCy: 'sidebar-stats-link',
    },
    {
      title: t('sidebar.navigation.settings'),
      icon: <Settings className="w-4 h-4" />,
      url: '/settings',
      dataCy: 'sidebar-settings-link',
    },
  ];

  // Check if user is system admin to show admin link
  // @ts-expect-error - isSystemAdmin is added by backend
  const isSystemAdmin = data?.user?.isSystemAdmin === true;

  // Add admin link for system admins
  if (isSystemAdmin) {
    items.push({
      title: t('sidebar.navigation.admin'),
      icon: <Shield className="w-4 h-4" />,
      url: '/admin',
      dataCy: 'sidebar-admin-link',
    });
  }

  const handleLogout = async () => {
    await authClient.signOut();
    navigate('/auth/sign-in');
  };

  return (
    <RootSidebar collapsible="icon">
      <OnBoarding
        isOpen={
          showCreateCompanyModal ||
          (!companyLoading &&
            (!activeCompany || !activeCompany.name) &&
            location.pathname !== '/settings/company')
        }
        onClose={() => setShowCreateCompanyModal(false)}
      />

      <SidebarHeader className="px-2">
        <CompanySwitcher onCreateNew={() => setShowCreateCompanyModal(true)} />
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup className="px-0">
          <SidebarGroupLabel>{t('sidebar.menu')}</SidebarGroupLabel>
          <SidebarMenu>
            {items.map((item, index) => (
              <SidebarMenuItem key={index}>
                <SidebarMenuButton asChild>
                  <Link
                    data-cy={item.dataCy}
                    to={item.url}
                    className={`flex items-center gap-2 py-6 ${
                      location.pathname.startsWith(item.url)
                        ? 'text-sidebar-accent-foreground bg-sidebar-accent'
                        : ''
                    }`}
                  >
                    {item.icon}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu className="flex flex-col gap-2">
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className={`${isOpen ? 'ml-2' : ''} w-8 h-8`}>
                  <Sun className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
                  <Moon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
                  <span className="sr-only">{t('sidebar.theme.toggleTheme')}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setTheme('light')}>
                  {t('sidebar.theme.light')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('dark')}>
                  {t('sidebar.theme.dark')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('system')}>
                  {t('sidebar.theme.system')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger className="cursor-pointer" asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <div className="bg-accent text-accent-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                    <User className="size-4" />
                  </div>
                  {userLoading ? (
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-2 w-1/2 mt-1" />
                    </div>
                  ) : (
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">
                        {/* @ts-ignore */}
                        {data?.user?.lastname} {data?.user?.firstname}
                      </span>
                      <span className="truncate text-xs">{data?.user?.email}</span>
                    </div>
                  )}
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                side={isMobile ? 'bottom' : 'right'}
                align="end"
                sideOffset={12}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">
                        {/* @ts-ignore */}
                        {data?.user?.lastname} {data?.user?.firstname}
                      </span>
                      <span className="truncate text-xs">{data?.user?.email}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem className="cursor-pointer">
                    <User className="w-4 h-4" />
                    {t('sidebar.userMenu.account')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuItem className="cursor-pointer" onClick={handleLogout}>
                  <LogOut />
                  {t('sidebar.userMenu.logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </RootSidebar>
  );
}
