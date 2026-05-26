import { forwardRef } from "react";

interface AppLogoProps {
  className?: string;
  size?: number;
}

export const AppLogo = forwardRef<SVGSVGElement, AppLogoProps>(
  ({ className, size = 24 }, ref) => {
    return (
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-label="SkillForge"
      >
        <defs>
          <linearGradient id="logoLeft" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          <linearGradient id="logoRight" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
          <linearGradient id="logoArc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>

        {/* Anvil left */}
        <path
          d="M 7 19 L 7 14 L 4 14 L 4 10 L 10 6 L 10 10"
          stroke="url(#logoLeft)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
        />

        {/* Anvil right */}
        <path
          d="M 10 6 L 10 10 L 17 10 L 17 14 L 14 14 L 14 19"
          stroke="url(#logoRight)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
        />

        {/* Connection arc */}
        <path
          d="M 4 10 Q 9 4 17 10"
          stroke="url(#logoArc)"
          strokeWidth="1.2"
          strokeLinecap="round"
          fill="none"
          opacity="0.6"
        />

        {/* Top node (purple, center) */}
        <circle cx="10" cy="6" r="1.8" fill="#8b5cf6" />

        {/* Right node (cyan) */}
        <circle cx="17" cy="10" r="1.4" fill="#06b6d4" />

        {/* Lower nodes (small) */}
        <circle cx="7" cy="15.5" r="1.1" fill="#3b82f6" opacity="0.7" />
        <circle cx="14" cy="15.5" r="1.1" fill="#06b6d4" opacity="0.7" />
      </svg>
    );
  }
);

AppLogo.displayName = "AppLogo";
