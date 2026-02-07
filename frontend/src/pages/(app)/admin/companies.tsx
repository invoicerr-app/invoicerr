import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { 
  Building2, 
  Users, 
  MoreHorizontal,
  Search,
  Trash2,
  Eye
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGet, useDelete } from '@/hooks/use-fetch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';
import { useState } from 'react';
import { toast } from 'sonner';

interface CompanyWithStats {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  memberCount: number;
  invoiceCount: number;
  quoteCount: number;
  isActive: boolean;
}

export default function AdminCompanies() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  
  const { data: companies, loading, mutate } = useGet<CompanyWithStats[]>('/api/admin/companies');
  const { trigger: deleteCompany } = useDelete('/api/admin/companies');

  const filteredCompanies = companies?.filter(company =>
    company.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    company.description?.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const handleDelete = async (companyId: string) => {
    if (!confirm(t('admin.companies.deleteConfirm'))) {
      return;
    }
    
    try {
      await deleteCompany({ id: companyId });
      toast.success(t('admin.companies.deleteSuccess'));
      mutate();
    } catch (error) {
      toast.error(t('admin.companies.deleteError'));
    }
  };

  const handleViewDetails = (companyId: string) => {
    navigate(`/admin/companies/${companyId}`);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 mt-2" />
        </div>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-64" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.companies.title')}</h1>
          <p className="text-muted-foreground">{t('admin.companies.description')}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t('admin.companies.list')}</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('admin.companies.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.companies.table.name')}</TableHead>
                <TableHead>{t('admin.companies.table.createdAt')}</TableHead>
                <TableHead>{t('admin.companies.table.members')}</TableHead>
                <TableHead>{t('admin.companies.table.documents')}</TableHead>
                <TableHead>{t('admin.companies.table.status')}</TableHead>
                <TableHead className="w-[100px]">{t('admin.companies.table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCompanies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Building2 className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{company.name}</p>
                        {company.description && (
                          <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                            {company.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {format(new Date(company.createdAt), 'PPP')}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      {company.memberCount}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {company.invoiceCount} {t('admin.companies.invoices')}
                      </Badge>
                      <Badge variant="outline">
                        {company.quoteCount} {t('admin.companies.quotes')}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={company.isActive ? 'default' : 'secondary'}>
                      {company.isActive 
                        ? t('admin.companies.status.active') 
                        : t('admin.companies.status.inactive')
                      }
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleViewDetails(company.id)}>
                          <Eye className="h-4 w-4 mr-2" />
                          {t('admin.companies.actions.view')}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleDelete(company.id)}
                          className="text-red-600"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t('admin.companies.actions.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {filteredCompanies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {searchQuery 
                      ? t('admin.companies.noResults') 
                      : t('admin.companies.empty')
                    }
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
