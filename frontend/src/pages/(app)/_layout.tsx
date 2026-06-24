import { Navigate, Outlet, useLocation } from "react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

import { PageHeaderProvider, usePageHeaderContext } from "@/components/page-header-provider";
import { Sidebar } from "@/components/sidebar";
import { authClient } from "@/lib/auth";

const ALLOWED_PATHS = [
    '/signature/[^/]+',
];

const PageHeaderTitle = () => {
    const { title } = usePageHeaderContext();

    if (!title) return null;

    return (
        <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        </div>
    );
};

const PageHeaderActions = () => {
    const { actions } = usePageHeaderContext();

    if (!actions) return null;

    return <div className="flex items-center gap-2 ml-auto">{actions}</div>;
};

const AuthenticatedLayout = () => {
    return (
        <SidebarProvider>
            <PageHeaderProvider>
                <section className="flex flex-col min-h-screen h-screen max-h-screen w-full max-w-screen overflow-y-auto overflow-x-hidden">
                    <main className="flex flex-1 h-full w-full max-w-screen overflow-y-auto overflow-x-hidden">
                        <Sidebar />
                        <section className="flex flex-col flex-1 h-full w-full max-w-screen overflow-hidden">
                            <header className="p-4 bg-header border-b flex items-center gap-4">
                                <SidebarTrigger />
                                <PageHeaderTitle />
                                <PageHeaderActions />
                            </header>
                            <section className="h-full overflow-y-auto overflow-x-hidden">
                                <Outlet />
                            </section>
                        </section>
                    </main>
                </section>
            </PageHeaderProvider>
        </SidebarProvider>
    );
};

const UnauthenticatedLayout = () => {
    return (
        <PageHeaderProvider>
            <section className="flex flex-col min-h-screen h-screen max-h-screen w-full max-w-screen overflow-y-auto overflow-x-hidden">
                <main className="flex flex-1 h-full w-full max-w-screen overflow-y-auto overflow-x-hidden">
                    <section className="flex flex-col flex-1 h-full w-full max-w-screen overflow-hidden">
                        <header className="p-4 bg-header border-b flex items-center gap-4">
                            <PageHeaderTitle />
                            <PageHeaderActions />
                        </header>
                        <section className="h-full overflow-y-auto overflow-x-hidden">
                            <Outlet />
                        </section>
                    </section>
                </main>
            </section>
        </PageHeaderProvider>
    );
};

const Layout = () => {
    const location = useLocation();
    const {
        data: session,
        isPending,
    } = authClient.useSession();

    if (isPending) {
        return null;
    }

    if (!session) {
        const isAllowedPath = ALLOWED_PATHS.some(path => location.pathname.match(new RegExp(path)));
        if (!isAllowedPath) {
            return <Navigate to="/auth/sign-in" />;
        }
        return <UnauthenticatedLayout />;
    }

    return <AuthenticatedLayout />;
};

export default Layout;