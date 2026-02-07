import { Outlet, Navigate, Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Building2,
  Users,
  Settings,
  Shield
} from 'lucide-react';
import { useIsSuperAdmin } from '@/hooks/use-role';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { authClient } from '@/lib/auth';

const adminMenuItems = [
  {
    value: 'dashboard',
    label: 'admin.tabs.dashboard',
    icon: LayoutDashboard,
    path: '/admin/dashboard',
  },
  {
    value: 'companies',
    label: 'admin.tabs.companies',
    icon: Building2,
    path: '/admin/companies',
  },
  {
    value: 'users',
    label: 'admin.tabs.users',
    icon: Users,
    path: '/admin/users',
  },
  {
    value: 'settings',
    label: 'admin.tabs.settings',
    icon: Settings,
    path: '/admin/settings',
  },
];

export default function AdminLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const { isPending: authPending } = authClient.useSession();
  const isSuperAdmin = useIsSuperAdmin();

  // Show loading state while auth is pending
  if (authPending) {
    return (
      <div className="flex items-center justify-center p-8">
        <Skeleton className="h-8 w-8" />
      </div>
    );
  }

  // Redirect non-superadmin users
  if (isSuperAdmin === false) {
    return <Navigate to="/dashboard" replace />;
  }

  // Show loading state while checking role
  if (isSuperAdmin === null) {
    return (
      <div className="flex items-center justify-center p-8">
        <Skeleton className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row h-full">
      {/* Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r bg-muted/20">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-purple-600" />
            <h2 className="text-lg font-semibold">{t('admin.title')}</h2>
          </div>
        </div>
        <nav className="flex-1 p-4">
          <ul className="space-y-1">
            {adminMenuItems.map((item) => (
              <li key={item.value}>
                <Link
                  to={item.path}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    location.pathname === item.path
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {t(item.label)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Mobile Menu */}
      <div className="lg:hidden p-4 border-b bg-muted/20">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-5 w-5 text-purple-600" />
          <h2 className="text-lg font-semibold">{t('admin.title')}</h2>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {adminMenuItems.map((item) => (
            <Link
              key={item.value}
              to={item.path}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors",
                location.pathname === item.path
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {t(item.label)}
            </Link>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
