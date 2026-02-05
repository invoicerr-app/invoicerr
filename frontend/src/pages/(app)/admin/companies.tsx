import { Building2, MoreHorizontal, Search } from 'lucide-react';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useGet, authenticatedFetch } from '@/hooks/use-fetch';
import type { CompanyRole } from '@/types';

interface CompanyUserInfo {
  userId: string;
  email: string;
  firstname: string;
  lastname: string;
  role: CompanyRole;
  joinedAt: string;
}

interface AdminCompany {
  id: string;
  name: string;
  country: string;
  currency: string;
  createdAt: string;
  users: CompanyUserInfo[];
}

export default function AdminCompaniesPage() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteCompanyId, setDeleteCompanyId] = useState<string | null>(null);

  const { data: companies, loading, mutate } = useGet<AdminCompany[]>('/api/admin/companies');

  const backendUrl = import.meta.env.VITE_BACKEND_URL || '';

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const handleDeleteCompany = async (companyId: string) => {
    try {
      const res = await authenticatedFetch(`${backendUrl}/api/admin/companies/${companyId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to delete company');
      }
      toast.success(t('admin.companies.messages.deleted'));
      mutate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete company');
    } finally {
      setDeleteCompanyId(null);
    }
  };

  const filteredCompanies = (companies || []).filter((company) => {
    const query = searchQuery.toLowerCase();
    return (
      company.name.toLowerCase().includes(query) ||
      company.country.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-emerald-100 rounded-lg">
          <Building2 className="h-5 w-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t('admin.companies.title')}</h1>
          <p className="text-muted-foreground">{t('admin.companies.description')}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('admin.companies.title')}</CardTitle>
              <CardDescription>{t('admin.companies.description')}</CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('admin.companies.search.placeholder')}
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
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-1/4" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredCompanies.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {searchQuery
                ? t('admin.companies.emptyState.noResults')
                : t('admin.companies.emptyState.noCompanies')}
            </div>
          ) : (
            <Table data-cy="admin-companies-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.companies.table.name')}</TableHead>
                  <TableHead>{t('admin.companies.table.country')}</TableHead>
                  <TableHead>{t('admin.companies.table.members')}</TableHead>
                  <TableHead>{t('admin.companies.table.createdAt')}</TableHead>
                  <TableHead className="w-[50px]">{t('admin.companies.table.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCompanies.map((company) => (
                  <TableRow key={company.id} data-cy={`admin-company-row-${company.id}`}>
                    <TableCell className="font-medium">{company.name}</TableCell>
                    <TableCell>{company.country}</TableCell>
                    <TableCell>{company.users?.length || 0}</TableCell>
                    <TableCell>{formatDate(company.createdAt)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-cy={`admin-company-actions-${company.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteCompanyId(company.id)}
                            data-cy={`admin-company-delete-${company.id}`}
                          >
                            {t('admin.companies.actions.delete')}
                          </DropdownMenuItem>
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

      <AlertDialog open={!!deleteCompanyId} onOpenChange={() => setDeleteCompanyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.companies.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('admin.companies.delete.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteCompanyId && handleDeleteCompany(deleteCompanyId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-cy="admin-company-delete-confirm"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
