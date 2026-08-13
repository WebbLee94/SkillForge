import { useEffect, useRef, useState, type ReactNode, type FocusEvent } from 'react';
import { createPortal } from 'react-dom';

interface TooltipPortalProps {
  children: ReactNode;
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  offsetY?: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onBlur?: (e: FocusEvent<HTMLDivElement>) => void;
}

export function TooltipPortal({
  children,
  triggerRef,
  open,
  offsetY = 8,
  onMouseEnter,
  onMouseLeave,
  onBlur,
}: TooltipPortalProps) {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + offsetY,
      left: rect.left + rect.width / 2,
    });
  }, [open, triggerRef, offsetY]);

  if (!open) return null;

  return createPortal(
    <div
      ref={tooltipRef}
      className="fixed z-[100] pointer-events-none -translate-x-1/2"
      style={{ top: pos.top, left: pos.left }}
    >
      <div
        data-tooltip-panel="true"
        className="rounded-lg border border-border bg-popover p-3 shadow-lg text-left min-w-[280px] max-w-[320px] pointer-events-auto"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onBlur={onBlur}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
