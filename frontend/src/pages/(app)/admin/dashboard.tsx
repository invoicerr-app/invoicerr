import { useTranslation } from 'react-i18next';
import {
  Building2,
  Users,
  TrendingUp,
  Activity,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSse } from '@/hooks/use-fetch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';

interface AdminDashboardData {
  totalCompanies: number;
  totalUsers: number;
  companies: {
    id: string;
    name: string;
    createdAt: string;
    memberCount: number;
  }[];
  recentActivity: {
    id: string;
    type: 'user_joined' | 'company_created' | 'invoice_created';
    description: string;
    companyName: string;
    timestamp: string;
  }[];
  stats: {
    companiesGrowth: number;
    usersGrowth: number;
  };
}

export default function AdminDashboard() {
  const { t } = useTranslation();
  const { data, loading } = useSse<AdminDashboardData>('/api/admin/dashboard/sse');

  const formatChange = (value: number) => {
    const isPositive = value >= 0;
    return (
      <div className={`flex items-center ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
        {isPositive ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
        <span className="text-sm font-medium">{Math.abs(value)}%</span>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 mt-2" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.dashboard.title')}</h1>
        <p className="text-muted-foreground">{t('admin.dashboard.description')}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t('admin.dashboard.totalCompanies')}
            </CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.totalCompanies || 0}</div>
            <div className="flex items-center text-xs text-muted-foreground mt-1">
              {formatChange(data?.stats.companiesGrowth || 0)}
              <span className="ml-1">{t('admin.dashboard.fromLastMonth')}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t('admin.dashboard.totalUsers')}
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.totalUsers || 0}</div>
            <div className="flex items-center text-xs text-muted-foreground mt-1">
              {formatChange(data?.stats.usersGrowth || 0)}
              <span className="ml-1">{t('admin.dashboard.fromLastMonth')}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t('admin.dashboard.activeCompanies')}
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.companies.length || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('admin.dashboard.withActivity')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t('admin.dashboard.recentActivity')}
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.recentActivity.length || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('admin.dashboard.last24Hours')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Companies List */}
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.companies.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data?.companies.map((company) => (
              <div
                key={company.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{company.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('admin.companies.createdAt', {
                        date: formatDistanceToNow(new Date(company.createdAt), { addSuffix: true })
                      })}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary">
                  {company.memberCount} {t('admin.companies.members')}
                </Badge>
              </div>
            ))}
            {(!data?.companies || data.companies.length === 0) && (
              <div className="text-center py-8 text-muted-foreground">
                {t('admin.companies.empty')}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.activity.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data?.recentActivity.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-4 p-4 border rounded-lg"
              >
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Activity className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">{activity.description}</p>
                  <p className="text-sm text-muted-foreground">
                    {activity.companyName} • {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
            {(!data?.recentActivity || data.recentActivity.length === 0) && (
              <div className="text-center py-8 text-muted-foreground">
                {t('admin.activity.empty')}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
