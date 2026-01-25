/** biome-ignore-all lint/a11y/noSvgWithoutTitle: SVG don't need titles */
import type { SVGProps } from 'react';

interface IconProps extends SVGProps<SVGSVGElement> {
  className?: string;
}

// SuperPDP - French B2B platform (stylized "S" with shield)
export function SuperPDPIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} {...props}>
      <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" stroke="currentColor" strokeWidth="1.5" fill="none" />
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
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      version="1.1"
      width="700"
      height="700"
      viewBox="610 105.5 700 700"
      {...props}
    >
      <g
        id="document"
        fill="#ffffff"
        fill-rule="nonzero"
        font-family="none"
        font-weight="none"
        font-size="none"
      >
        <rect
          x="610"
          y="75.35714"
          transform="scale(1,1.4)"
          width="700"
          height="500"
          id="Shape-1-1"
        />
      </g>
      <g
        fill="none"
        fill-rule="nonzero"
        stroke="currentColor"
        stroke-width="none"
        stroke-linecap="none"
        stroke-linejoin="none"
        stroke-miterlimit="10"
        font-family="none"
        font-weight="none"
        font-size="none"
      >
        <g id="stage">
          <g id="layer1-1">
            <path
              d="M859.99049,516.5c0,-24.57667 19.69947,-44.5 44,-44.5c24.30053,0 44,19.92333 44,44.5c0,24.57667 -19.69947,44.5 -44,44.5c-24.30053,0 -44,-19.92333 -44,-44.5z"
              id="Path-1"
              fill-opacity="0"
              fill="currentColor"
              stroke-width="20"
              stroke-linecap="butt"
              stroke-linejoin="miter"
            />
            <path
              d="M1046.49049,472c0,-16.01626 12.98374,-29 29,-29c16.01626,0 29,12.98374 29,29c0,16.01626 -12.98374,29 -29,29c-16.01626,0 -29,-12.98374 -29,-29z"
              id="Path-1-1"
              fill="currentColor"
              stroke-width="1"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M859.99049,356c0,-16.01626 12.98374,-29 29,-29c16.01626,0 29,12.98374 29,29c0,16.01626 -12.98374,29 -29,29c-16.01626,0 -29,-12.98374 -29,-29z"
              id="Path-3741-1"
              fill="currentColor"
              stroke-width="1"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M855.94073,498.08372c0,0 -71.70667,-58.23783 -99.91453,-87.56581c-37.86447,-44.7855 -58.8615,-77.91841 -46.01854,-101.14909c21.75508,-36.00145 85.46767,-9.79039 85.46767,-9.79039l-15.38545,24.33647l-10.89646,-3.89259c0,0 -28.63313,-4.70572 -34.46659,0.80545c-3.64796,11.89504 18.49142,41.11667 18.49142,41.11667l41.9921,48.23356l77.71722,66.9921z"
              id="Path-1-2"
              fill="currentColor"
              stroke-width="1"
              stroke-linecap="butt"
              stroke-linejoin="miter"
            />
            <path
              d="M748.28215,454.39032c0,-122.22091 96.97652,-221.30053 216.60312,-221.30053c119.6266,0 216.60312,99.07962 216.60312,221.30053c0,122.22091 -96.97652,221.30053 -216.60312,221.30053c-119.6266,0 -216.60312,-99.07962 -216.60312,-221.30053z"
              id="Path-1-3"
              fill-opacity="0"
              fill="currentColor"
              stroke-width="26"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M885.8395,476.06245c0,0 -13.38475,-77.84024 -9.73293,-118.36774c-4.11437,-130.38693 18.86541,-190.03915 44.82681,-195.57194c41.44747,-7.17604 63.42672,58.11735 63.42672,58.11735l-28.46328,4.33795l-4.20463,-10.7799c0,0 -15.21911,-24.70584 -23.20507,-25.49744c-11.37353,5.04404 -18.92365,40.91954 -18.92365,40.91954c0,0 -6.99142,64.39353 -8.20028,90.92445c-2.02072,44.34914 7.9557,150.89399 7.9557,150.89399z"
              id="Path-11109-1"
              fill="currentColor"
              stroke-width="1"
              stroke-linecap="butt"
              stroke-linejoin="miter"
            />
            <path
              d="M857.28425,537.06828c0,0 -38.11524,9.71404 -78.80938,8.97227c-58.45181,-4.84712 -89.82786,-7.91548 -97.14023,-33.58603c-10.02064,-41.10274 53.61882,-67.8868 53.61882,-67.8868l6.29266,28.26913l-10.4671,5.00031c0,0 -23.60378,17.06601 -23.8427,25.14249c5.81815,11.05699 42.13905,16.04913 42.13905,16.04913l61.05139,-1.16274l40.27765,-4.32586z"
              id="Path-12125-1"
              fill="currentColor"
              stroke-width="1"
              stroke-linecap="butt"
              stroke-linejoin="miter"
            />
            <path
              d="M958.87489,516.5c0,0 77.56781,-14.90093 114.20309,-32.61282c97.37359,-33.21571 147.15368,-70.0139 161.88797,-96.97641c3.94828,-7.22502 5.38008,-13.74379 4.53683,-19.29812c-7.92089,-41.37518 -76.02443,-33.64622 -76.02443,-33.64622l5.37106,24.89554l5.5729,0.55356c0,0 18.04491,0.7085 23.47471,3.31461c7.25795,2.19133 14.87817,6.69489 16.44092,9.85719c-0.70385,12.43785 -32.85057,34.64559 -32.85057,34.64559c0,0 -57.78934,29.2566 -82.18957,39.74394c-40.78747,17.53066 -144.01292,45.74671 -144.01292,45.74671z"
              id="Path-15259-1"
              fill="currentColor"
              stroke-width="1"
              stroke-linecap="butt"
              stroke-linejoin="miter"
            />
            <path
              d="M926.17416,551.33914c0,0 58.98626,40.13375 96.5011,53.80633c61.6587,33.88259 134.15132,62.13942 169.82979,31.71869c17.72865,-41.32464 -24.79168,-80.70569 -24.79168,-80.70569l-16.16328,26.41577l3.49223,4.37812c0,0 9.65914,10.64843 11.58129,16.35631c3.49493,6.72795 3.85423,12.21096 2.67957,15.53699c-9.40033,8.17492 -41.15729,-0.04806 -41.15729,-0.04806c0,0 -57.59864,-20.81328 -86.8593,-34.84152c-31.85439,-15.27174 -96.65667,-54.39947 -96.65667,-54.39947z"
              id="Path-16941-1"
              fill="currentColor"
              stroke-width="1"
              stroke-linecap="butt"
              stroke-linejoin="miter"
            />
            <path
              d="M894.28892,554.19972c0,0 -3.28125,11.32077 11.85395,48.26977c16.43628,68.40814 44.32489,141.04321 90.83705,146.95871c42.49663,-14.69922 43.00752,-72.65252 43.00752,-72.65252l-30.41603,5.8232l-0.88789,5.52949c0,0 -1.37523,14.31072 -4.30333,19.57387c-2.62409,7.11295 -6.43769,11.06882 -9.68829,12.43846c-12.37296,-1.45099 -27.66374,-30.47363 -27.66374,-30.47363c0,0 -23.3703,-56.60941 -32.68729,-87.69271c-10.14286,-33.8386 -14.5881,-51.85219 -14.5881,-51.85219z"
              id="Path-17704-1"
              fill="currentColor"
              stroke-width="1"
              stroke-linecap="butt"
              stroke-linejoin="miter"
            />
          </g>
        </g>
      </g>
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
      <path
        d="M7 8h10M7 12h10M7 16h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
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
