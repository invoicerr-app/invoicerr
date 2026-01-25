import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getPlatformIcon } from '@/components/icons/platforms';
import { Button } from '@/components/ui/button';
import { useCompliance } from '@/hooks/use-compliance';
import type { Client, Company } from '@/types';

interface TransmissionButtonProps {
  company: Company;
  client: Client;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Button component that displays the appropriate transmission method
 * based on supplier and customer countries compliance configuration.
 */
export function TransmissionButton({
  company,
  client,
  onClick,
  disabled = false,
  className = '',
}: TransmissionButtonProps) {
  const { t } = useTranslation();

  // Determine transaction type based on client type
  const transactionType = useMemo(() => {
    // INDIVIDUAL = B2C, COMPANY = B2B (B2G would need additional flag)
    return client.type === 'INDIVIDUAL' ? 'B2C' : 'B2B';
  }, [client.type]);

  // Get compliance config for this company/client combination
  const { config, isLoading } = useCompliance({
    supplierCountry: company.country,
    customerCountry: client.country,
    transactionType,
  });

  // Get transmission info
  const transmissionInfo = useMemo(() => {
    if (!config?.transmission) {
      return {
        labelKey: 'transmission.email',
        icon: 'mail',
        platform: 'email',
      };
    }
    return {
      labelKey: config.transmission.labelKey || 'transmission.email',
      icon: config.transmission.icon || 'mail',
      platform: config.transmission.platform || 'email',
    };
  }, [config]);

  // Get the icon component based on platform
  const IconComponent = getPlatformIcon(transmissionInfo.platform || 'email');

  // Build tooltip text
  const tooltip = useMemo(() => {
    // Use the platform name (e.g., "superpdp") for the tooltip
    const platformKey = `platform.${transmissionInfo.platform}`;
    const platformLabel = t(platformKey, { defaultValue: '' });

    if (platformLabel && platformLabel !== platformKey) {
      return t('invoices.list.tooltips.sendVia', {
        platform: platformLabel,
        defaultValue: `Send via ${platformLabel}`,
      });
    }
    // Fallback to generic send
    return t('invoices.list.tooltips.sendByEmail');
  }, [t, transmissionInfo.platform]);

  return (
    <Button
      tooltip={tooltip}
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`text-gray-600 hover:text-purple-600 ${className}`}
    >
      <IconComponent className="h-4 w-4" />
    </Button>
  );
}
