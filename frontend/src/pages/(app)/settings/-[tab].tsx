import {
  AlertTriangle,
  Building2,
  FileText,
  Globe,
  Mail,
  Plug,
  TicketIcon,
  User,
  Webhook,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import AccountSettings from './_components/account.settings';
import CompanySettings from './_components/company.settings';
import ComplianceSettings from './_components/compliance.settings';
import DangerZoneSettings from './_components/danger.settings';
import InvitationsSettings from './_components/invitations.settings';
import { LogsSettings } from './_components/logs.settings';
import PDFTemplatesSettings from './_components/pdf.settings';
import PluginsSettings from './_components/plugins.settings';
import EmailTemplatesSettings from './_components/templates.settings';
import WebhooksSettings from './_components/webhooks.settings';

export default function Settings() {
  const { t } = useTranslation();
  const { tab } = useParams();
  const navigate = useNavigate();

  const validTabs = [
    'company',
    'compliance',
    'template',
    'email',
    'webhooks',
    'logs',
    'account',
    'invitations',
    'plugins',
    'danger',
  ];
  const currentTab = validTabs.includes(tab!) ? tab! : 'company';

  const handleTabChange = (newTab: string) => {
    navigate(`/settings/${newTab}`);
  };

  const menuItems = [
    {
      value: 'company',
      label: t('settings.tabs.company'),
      icon: Building2,
    },
    {
      value: 'compliance',
      label: t('settings.tabs.compliance'),
      icon: Globe,
    },
    {
      value: 'template',
      label: t('settings.tabs.pdfTemplates'),
      icon: FileText,
    },
    {
      value: 'email',
      label: t('settings.tabs.emailTemplates'),
      icon: Mail,
    },
    {
      value: 'webhooks',
      label: t('settings.tabs.webhooks'),
      icon: Webhook,
    },
    {
      value: 'logs',
      label: t('settings.tabs.logs'),
      icon: FileText,
    },
    {
      value: 'account',
      label: t('settings.tabs.account'),
      icon: User,
    },
    {
      value: 'invitations',
      label: t('settings.tabs.invitations'),
      icon: TicketIcon,
    },
    {
      value: 'plugins',
      label: t('settings.tabs.plugins'),
      icon: Plug,
    },
    {
      value: 'danger',
      label: t('settings.tabs.dangerZone'),
      icon: AlertTriangle,
    },
  ];

  const currentMenuItem = menuItems.find((item) => item.value === currentTab);

  const renderContent = () => {
    switch (currentTab) {
      case 'company':
        return <CompanySettings />;
      case 'compliance':
        return <ComplianceSettings />;
      case 'template':
        return <PDFTemplatesSettings />;
      case 'email':
        return <EmailTemplatesSettings />;
      case 'webhooks':
        return <WebhooksSettings />;
      case 'logs':
        return <LogsSettings />;
      case 'account':
        return <AccountSettings />;
      case 'invitations':
        return <InvitationsSettings />;
      case 'plugins':
        return <PluginsSettings />;
      case 'danger':
        return <DangerZoneSettings />;
      default:
        return <CompanySettings />;
    }
  };

  return (
    <div className="h-full flex flex-col lg:flex-row">
      <div className="lg:hidden p-4">
        <Select value={currentTab} onValueChange={handleTabChange}>
          <SelectTrigger className="w-full h-12">
            <SelectValue>
              <div className="flex items-center gap-2">
                {currentMenuItem?.icon && <currentMenuItem.icon className="h-4 w-4" />}
                {currentMenuItem?.label}
              </div>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {menuItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                <div className="flex items-center gap-2">
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r bg-muted/30">
        <div className="p-6">
          <h2 className="text-lg font-semibold">{t('settings.title') || 'Settings'}</h2>
        </div>
        <nav className="flex-1 px-3 pb-6">
          <ul className="space-y-1">
            {menuItems.map((item) => (
              <li key={item.value}>
                <button
                  onClick={() => handleTabChange(item.value)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                    currentTab === item.value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">{renderContent()}</div>
      </main>
    </div>
  );
}
