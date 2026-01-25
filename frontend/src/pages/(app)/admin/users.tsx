import { MoreHorizontal, Search, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useGet, authenticatedFetch } from '@/hooks/use-fetch';
import type { CompanyRole } from '@/types';

interface UserCompanyInfo {
  companyId: string;
  companyName: string;
  role: CompanyRole;
  joinedAt: string;
  isDefault: boolean;
}

interface AdminUser {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  isSystemAdmin: boolean;
  createdAt: string;
  companies: UserCompanyInfo[];
}

export default function AdminUsersPage() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: users, loading, mutate } = useGet<AdminUser[]>('/api/admin/users');

  const backendUrl = import.meta.env.VITE_BACKEND_URL || '';

  const handleGrantAdmin = async (userId: string) => {
    try {
      const res = await authenticatedFetch(`${backendUrl}/api/admin/users/${userId}/grant-admin`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to grant admin');
      }
      toast.success(t('admin.users.messages.adminGranted'));
      mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to grant admin');
    }
  };

  const handleRevokeAdmin = async (userId: string) => {
    try {
      const res = await authenticatedFetch(`${backendUrl}/api/admin/users/${userId}/revoke-admin`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to revoke admin');
      }
      toast.success(t('admin.users.messages.adminRevoked'));
      mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to revoke admin');
    }
  };

  const getRoleBadgeVariant = (isSystemAdmin: boolean) => {
    return isSystemAdmin ? 'destructive' : 'secondary';
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const filteredUsers = (users || []).filter((user) => {
    const query = searchQuery.toLowerCase();
    return (
      user.email.toLowerCase().includes(query) ||
      user.firstname.toLowerCase().includes(query) ||
      user.lastname.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-100 rounded-lg">
          <Users className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t('admin.users.title')}</h1>
          <p className="text-muted-foreground">{t('admin.users.description')}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('admin.users.title')}</CardTitle>
              <CardDescription>{t('admin.users.description')}</CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('admin.users.search.placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-1/4" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {searchQuery
                ? t('admin.users.emptyState.noResults')
                : t('admin.users.emptyState.noUsers')}
            </div>
          ) : (
            <Table data-cy="admin-users-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.users.table.name')}</TableHead>
                  <TableHead>{t('admin.users.table.email')}</TableHead>
                  <TableHead>{t('admin.users.table.role')}</TableHead>
                  <TableHead>{t('admin.users.table.createdAt')}</TableHead>
                  <TableHead className="w-[50px]">{t('admin.users.table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id} data-cy={`admin-user-row-${user.id}`}>
                    <TableCell className="font-medium">
                      {user.firstname} {user.lastname}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={getRoleBadgeVariant(user.isSystemAdmin)}>
                        {user.isSystemAdmin ? t('admin.users.roles.SYSTEM_ADMIN') : t('admin.users.roles.USER')}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(user.createdAt)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-cy={`admin-user-actions-${user.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {user.isSystemAdmin ? (
                            <DropdownMenuItem
                              onClick={() => handleRevokeAdmin(user.id)}
                              data-cy={`admin-user-revoke-${user.id}`}
                            >
                              {t('admin.users.actions.revokeAdmin')}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => handleGrantAdmin(user.id)}
                              data-cy={`admin-user-grant-${user.id}`}
                            >
                              {t('admin.users.actions.grantAdmin')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
