import { Navigate, Outlet, useLocation } from 'react-router';
import { Sidebar } from '@/components/sidebar';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { authClient } from '@/lib/auth';

const ALLOWED_PATHS = ['/signature/[^/]+'];

const AuthenticatedLayout = () => {
  return (
    <SidebarProvider>
      <section className="flex flex-col min-h-screen h-screen max-h-screen w-full max-w-screen overflow-y-auto overflow-x-hidden">
        <main className="flex flex-1 h-full w-full max-w-screen overflow-y-auto overflow-x-hidden">
          <Sidebar />
          <section className="flex flex-col flex-1 h-full w-full max-w-screen overflow-hidden">
            <header className="p-4 bg-header border-b">
              <SidebarTrigger />
            </header>
            <section className="h-full overflow-y-auto overflow-x-hidden">
              <Outlet />
            </section>
          </section>
        </main>
      </section>
    </SidebarProvider>
  );
};

const UnauthenticatedLayout = () => {
  return (
    <section className="flex flex-col min-h-screen h-screen max-h-screen w-full max-w-screen overflow-y-auto overflow-x-hidden">
      <main className="flex flex-1 h-full w-full max-w-screen overflow-y-auto overflow-x-hidden">
        <section className="flex flex-col flex-1 h-full w-full max-w-screen overflow-hidden">
          <header className="p-4 bg-header border-b" />
          <section className="h-full overflow-y-auto overflow-x-hidden">
            <Outlet />
          </section>
        </section>
      </main>
    </section>
  );
};

const Layout = () => {
  const location = useLocation();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return null;
  }

  if (!session) {
    const isAllowedPath = ALLOWED_PATHS.some((path) => location.pathname.match(new RegExp(path)));
    if (!isAllowedPath) {
      return <Navigate to="/auth/sign-in" />;
    }
    return <UnauthenticatedLayout />;
  }

  return <AuthenticatedLayout />;
};

export default Layout;
