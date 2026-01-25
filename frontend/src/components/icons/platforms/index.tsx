import type { SVGProps } from 'react';

interface IconProps extends SVGProps<SVGSVGElement> {
  className?: string;
}

// SuperPDP - French B2B platform (stylized "S" with shield)
export function SuperPDPIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} {...props}>
      <path
        d="M12 2L3 7v10l9 5 9-5V7l-9-5z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M15 9.5c0-1.38-1.12-2.5-2.5-2.5H9v10h2v-3h1.5c1.38 0 2.5-1.12 2.5-2.5v-2z"
        fill="currentColor"
      />
      <path d="M11 9h1.5c.28 0 .5.22.5.5v2c0 .28-.22.5-.5.5H11V9z" fill="white" />
    </svg>
  );
}

// Peppol - EU network (stylized "P" with globe lines)
export function PeppolIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="12" cy="12" rx="4" ry="9" stroke="currentColor" strokeWidth="1" />
      <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1" />
      <line x1="4.5" y1="7" x2="19.5" y2="7" stroke="currentColor" strokeWidth="0.75" />
      <line x1="4.5" y1="17" x2="19.5" y2="17" stroke="currentColor" strokeWidth="0.75" />
    </svg>
  );
}

// SDI - Italian Sistema di Interscambio (stylized "SDI" in rectangle)
export function SDIIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} {...props}>
      <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <text
        x="12"
        y="14"
        textAnchor="middle"
        fontSize="7"
        fontWeight="bold"
        fill="currentColor"
        fontFamily="system-ui"
      >
        SDI
      </text>
    </svg>
  );
}

// Chorus Pro - French B2G platform (building with musical note hint)
export function ChorusProIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} {...props}>
      <path d="M3 21h18v-2H3v2z" fill="currentColor" />
      <path d="M5 19V9h3v10H5z" fill="currentColor" />
      <path d="M10 19V9h3v10h-3z" fill="currentColor" />
      <path d="M15 19V9h3v10h-3z" fill="currentColor" />
      <path d="M2 9l10-6 10 6H2z" fill="currentColor" />
      <circle cx="12" cy="5" r="1.5" fill="white" />
    </svg>
  );
}

// XRechnung - German standard (stylized "X" with document)
export function XRechnungIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} {...props}>
      <path
        d="M6 2h8l6 6v14H6a2 2 0 01-2-2V4a2 2 0 012-2z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 12l3 4m0-4l-3 4M13 12l3 4m0-4l-3 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Factur-X / ZUGFeRD - Franco-German hybrid (document with "FX")
export function FacturXIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} {...props}>
      <path
        d="M6 2h8l6 6v14H6a2 2 0 01-2-2V4a2 2 0 012-2z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" />
      <text
        x="10"
        y="16"
        textAnchor="middle"
        fontSize="6"
        fontWeight="bold"
        fill="currentColor"
        fontFamily="system-ui"
      >
        FX
      </text>
    </svg>
  );
}

// Email - standard envelope
export function EmailIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} {...props}>
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 6l10 7 10-7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// IRP - India's Invoice Registration Portal
export function IRPIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <text
        x="12"
        y="15"
        textAnchor="middle"
        fontSize="7"
        fontWeight="bold"
        fill="currentColor"
        fontFamily="system-ui"
      >
        IRP
      </text>
    </svg>
  );
}

// Generic platform icon
export function GenericPlatformIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 8h10M7 12h10M7 16h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Map platform IDs to icons
export const platformIcons: Record<string, React.ComponentType<IconProps>> = {
  superpdp: SuperPDPIcon,
  peppol: PeppolIcon,
  sdi: SDIIcon,
  chorus: ChorusProIcon,
  choruspro: ChorusProIcon,
  'chorus-pro': ChorusProIcon,
  xrechnung: XRechnungIcon,
  facturx: FacturXIcon,
  'factur-x': FacturXIcon,
  zugferd: FacturXIcon,
  email: EmailIcon,
  irp: IRPIcon,
  // Add more as needed
};

// Helper to get icon component by platform ID
export function getPlatformIcon(platformId: string): React.ComponentType<IconProps> {
  return platformIcons[platformId.toLowerCase()] || GenericPlatformIcon;
}
