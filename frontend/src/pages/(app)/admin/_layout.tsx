import { Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth';

export default function AdminLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  // Loading state
  if (isPending) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Check if user is system admin
  // @ts-expect-error - role is added by backend
  const isSystemAdmin = session?.user?.role === 'SYSTEM_ADMIN';

  if (!isSystemAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  const menuItems = [
    { path: '/admin/users', label: t('admin.navigation.users') },
    { path: '/admin/companies', label: t('admin.navigation.companies') },
  ];

  return (
    <div className="h-full flex flex-col lg:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r bg-muted/30">
        <div className="p-6 flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">{t('admin.title')}</h2>
        </div>
        <nav className="flex-1 px-3 pb-6">
          <ul className="space-y-1">
            {menuItems.map((item) => (
              <li key={item.path}>
                <Button
                  variant={location.pathname === item.path ? 'secondary' : 'ghost'}
                  className="w-full justify-start"
                  onClick={() => navigate(item.path)}
                >
                  {item.label}
                </Button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Mobile header */}
      <div className="lg:hidden p-4 border-b flex items-center gap-3">
        <Shield className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">{t('admin.title')}</h2>
      </div>

      {/* Mobile navigation */}
      <div className="lg:hidden px-4 py-2 border-b flex gap-2 overflow-x-auto">
        {menuItems.map((item) => (
          <Button
            key={item.path}
            variant={location.pathname === item.path ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => navigate(item.path)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
