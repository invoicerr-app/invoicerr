/**
 * Document archiving configuration
 */
export interface ArchivingConfig {
  /** Retention period in years */
  retentionYears: number;
  /** Required archive format (e.g., 'PDF/A-3', 'original') */
  formatRequired?: string;
  /** Must archived documents be searchable */
  searchable?: boolean;
  /** Required searchable fields */
  searchFields?: string[];
  /** Data residency requirement (country code or 'any') */
  dataResidency?: string;
  /** Does the platform store a copy */
  platformStoresCopy?: boolean;
}
