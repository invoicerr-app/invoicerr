import {useId} from 'react';
import type {ReactNode} from 'react';

/**
 * The Invoicerr mark ("07 Faille" — a rounded plane cut once by a single clean diagonal, both
 * halves still legibly one shape). Copied verbatim from `frontend/src/components/brand-mark.tsx`'s
 * static SVG path data, not rasterised, so this renders the identical geometry the app itself uses
 * rather than a lower-fidelity export — only the app's own cause-day colour swap and i18n tooltip
 * are dropped, since neither applies to this static doc shell. `fill="currentColor"` is kept so a
 * caller's own text colour decides ink-on-light vs. foam-on-dark, exactly like the source component.
 *
 * `useId()` namespaces the clip-path ids the same way the original does: this is inlined (not an
 * `<img>`), so two instances on one page would otherwise collide on the same `id` and silently clip
 * nothing for the second one — relevant here because the homepage hero renders one instance.
 */
export default function BrandMark({className}: {className?: string}): ReactNode {
  const uid = useId();
  const clipA = `doc-brand-mark-a-${uid}`;
  const clipB = `doc-brand-mark-b-${uid}`;

  return (
    <svg viewBox="0 0 512 512" fill="none" aria-hidden="true" className={className}>
      <defs>
        <clipPath id={clipA}>
          <path d="M533.494 -600.41 L-61.136 1098.535 L-910.609 801.22 L-315.978 -897.725 Z" />
        </clipPath>
        <clipPath id={clipB}>
          <path d="M573.136 -586.535 L-21.494 1112.41 L827.978 1409.725 L1422.609 -289.22 Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipA})`}>
        <path
          d="M168 96H344A72 72 0 0 1 416 168V344A72 72 0 0 1 344 416H168A72 72 0 0 1 96 344V168A72 72 0 0 1 168 96Z"
          fill="currentColor"
        />
      </g>
      <g transform="translate(18.5 -52.856)" clipPath={`url(#${clipB})`}>
        <path
          d="M168 96H344A72 72 0 0 1 416 168V344A72 72 0 0 1 344 416H168A72 72 0 0 1 96 344V168A72 72 0 0 1 168 96Z"
          fill="currentColor"
        />
      </g>
    </svg>
  );
}
