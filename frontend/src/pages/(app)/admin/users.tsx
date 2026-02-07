import { useTranslation } from 'react-i18next';
import { 
  Users, 
  Search,
  MoreHorizontal,
  Trash2,
  Mail,
  Shield,
  User
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGet } from '@/hooks/use-fetch';
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
import { UserRole } from '@/contexts/company-context';

interface UserWithCompanies {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  createdAt: string;
  companies: {
    companyId: string;
    companyName: string;
    role: UserRole;
  }[];
  isActive: boolean;
}

const roleColors: Record<UserRole, string> = {
  SUPERADMIN: 'bg-purple-100 text-purple-700 border-purple-200',
  ADMIN: 'bg-blue-100 text-blue-700 border-blue-200',
  USER: 'bg-gray-100 text-gray-700 border-gray-200',
};

export default function AdminUsers() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  
  const { data: users, loading } = useGet<UserWithCompanies[]>('/api/admin/users');

  const filteredUsers = users?.filter(user =>
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.firstname?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.lastname?.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

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
          <h1 className="text-2xl font-bold">{t('admin.users.title')}</h1>
          <p className="text-muted-foreground">{t('admin.users.description')}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t('admin.users.list')}</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('admin.users.searchPlaceholder')}
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
                <TableHead>{t('admin.users.table.user')}</TableHead>
                <TableHead>{t('admin.users.table.joined')}</TableHead>
                <TableHead>{t('admin.users.table.companies')}</TableHead>
                <TableHead>{t('admin.users.table.roles')}</TableHead>
                <TableHead>{t('admin.users.table.status')}</TableHead>
                <TableHead className="w-[100px]">{t('admin.users.table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">
                          {user.firstname} {user.lastname}
                        </p>
                        <p className="text-sm text-muted-foreground flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {format(new Date(user.createdAt), 'PPP')}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.companies.map((company) => (
                        <Badge key={company.companyId} variant="outline">
                          {company.companyName}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.companies.some(c => c.role === 'SUPERADMIN') && (
                        <Badge className={roleColors.SUPERADMIN}>
                          <Shield className="h-3 w-3 mr-1" />
                          {t('company.roles.SUPERADMIN')}
                        </Badge>
                      )}
                      {user.companies.some(c => c.role === 'ADMIN') && (
                        <Badge className={roleColors.ADMIN}>
                          {t('company.roles.ADMIN')}
                        </Badge>
                      )}
                      {user.companies.every(c => c.role === 'USER') && (
                        <Badge className={roleColors.USER}>
                          {t('company.roles.USER')}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isActive ? 'default' : 'secondary'}>
                      {user.isActive 
                        ? t('admin.users.status.active') 
                        : t('admin.users.status.inactive')
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
                        <DropdownMenuItem>
                          <Mail className="h-4 w-4 mr-2" />
                          {t('admin.users.actions.email')}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          className="text-red-600"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t('admin.users.actions.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {filteredUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {searchQuery 
                      ? t('admin.users.noResults') 
                      : t('admin.users.empty')
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
