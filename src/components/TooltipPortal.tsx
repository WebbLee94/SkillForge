import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipPortalProps {
  children: ReactNode;
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  offsetY?: number;
}

export function TooltipPortal({
  children,
  triggerRef,
  open,
  offsetY = 8,
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
      <div className="rounded-lg border border-border bg-popover p-3 shadow-lg text-left min-w-[280px] max-w-[320px]">
        {children}
      </div>
    </div>,
    document.body
  );
}
