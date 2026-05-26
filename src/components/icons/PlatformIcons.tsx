interface IconProps {
  className?: string;
}

function ClaudeCodeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" opacity="0.15" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor" fontFamily="system-ui">C*</text>
    </svg>
  );
}

function OpenCodeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" opacity="0.15" />
      <path d="M9 7L5 12L9 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 7L19 12L15 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CursorIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" opacity="0.15" />
      <path d="M8 5L8 14L11 11L15 18L17 17L13 10L17 9L8 5Z" fill="currentColor" />
    </svg>
  );
}

function TraeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" opacity="0.15" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor" fontFamily="system-ui">T</text>
    </svg>
  );
}

function CodeBuddyIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" opacity="0.15" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor" fontFamily="system-ui">CB</text>
    </svg>
  );
}

function CodexIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" opacity="0.15" />
      <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor" fontFamily="system-ui">X</text>
    </svg>
  );
}

function DefaultPlatformIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" opacity="0.15" />
      <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 18C7 15.2386 9.23858 13 12 13C14.7614 13 17 15.2386 17 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const platformIconMap: Record<string, React.FC<IconProps>> = {
  "claude-code": ClaudeCodeIcon,
  "claude": ClaudeCodeIcon,
  "opencode": OpenCodeIcon,
  "cursor": CursorIcon,
  "trae": TraeIcon,
  "codebuddy": CodeBuddyIcon,
  "codex": CodexIcon,
};

export function getPlatformIcon(platformId: string): React.FC<IconProps> {
  return platformIconMap[platformId.toLowerCase()] ?? DefaultPlatformIcon;
}

export { DefaultPlatformIcon };
