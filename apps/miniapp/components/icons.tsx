/**
 * A small stroke icon set. Drawn inline rather than pulled from a package so the
 * Mini App ships no icon font and every glyph inherits the current text colour.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={20}
      height={20}
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.6 10.4 12 3.8l8.4 6.6" />
    <path d="M5.6 9.4V19a1.4 1.4 0 0 0 1.4 1.4h10a1.4 1.4 0 0 0 1.4-1.4V9.4" />
    <path d="M9.7 20.4v-5.3h4.6v5.3" />
  </Icon>
);

export const LearnIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 6.6C10.5 5.3 8.6 4.7 6 4.7a1 1 0 0 0-1 1v11.1a1 1 0 0 0 1 1c2.6 0 4.5.6 6 1.9 1.5-1.3 3.4-1.9 6-1.9a1 1 0 0 0 1-1V5.7a1 1 0 0 0-1-1c-2.6 0-4.5.6-6 1.9Z" />
    <path d="M12 6.6v13.1" />
  </Icon>
);

export const CommunitiesIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="9" cy="8.4" r="3.1" />
    <path d="M3.4 19.6c0-2.9 2.5-4.7 5.6-4.7s5.6 1.8 5.6 4.7" />
    <path d="M16.2 5.6a3.1 3.1 0 0 1 0 5.9" />
    <path d="M17.6 15.3c1.9.5 3.2 1.8 3.2 4" />
  </Icon>
);

export const RewardsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m12 3.4 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.6l5.9-.9Z" />
  </Icon>
);

export const WalletIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.6 8.4c0-1.2 1-2.2 2.2-2.2h11.3c1.3 0 2.3 1 2.3 2.3v9.1c0 1.3-1 2.3-2.3 2.3H5.8a2.2 2.2 0 0 1-2.2-2.2Z" />
    <path d="M3.6 9.3V7.1c0-1 .7-1.9 1.7-2.1l9-1.6" />
    <circle cx="16.4" cy="12.9" r="1.2" fill="currentColor" stroke="none" />
  </Icon>
);

export const SparkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9Z" />
    <path d="M18.6 16.2l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7Z" />
  </Icon>
);

export const ChevronIcon = (props: IconProps) => (
  <Icon width={18} height={18} strokeWidth={2} {...props}>
    <path d="m9.5 5.5 6.2 6.5-6.2 6.5" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon width={16} height={16} strokeWidth={2.4} {...props}>
    <path d="m5 12.6 4.4 4.4L19 6.6" />
  </Icon>
);

export const InboxIcon = (props: IconProps) => (
  <Icon width={26} height={26} {...props}>
    <path d="M3.6 13.4h4.1l1.4 2.6h5.8l1.4-2.6h4.1" />
    <path d="M5.9 5.4h12.2l2.3 8v4.2a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2v-4.2Z" />
  </Icon>
);

export const BoltIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13.4 3.2 5.8 13.4h5.1l-.3 7.4 7.6-10.2h-5.1Z" />
  </Icon>
);
