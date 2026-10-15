"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/** Same breakpoint as Tailwind's `xl`: from here the header shows the full link row. */
const DESKTOP_QUERY = "(min-width: 80rem)";

/** Pixel burger (three bars) that turns into a pixel cross while the menu is open. */
function BurgerIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="block"
      height="24"
      shapeRendering="crispEdges"
      viewBox="0 0 12 12"
      width="24"
    >
      <g fill="currentColor">
        {open ? (
          <>
            <rect height="2" width="2" x="1" y="1" />
            <rect height="2" width="2" x="3" y="3" />
            <rect height="2" width="2" x="5" y="5" />
            <rect height="2" width="2" x="7" y="7" />
            <rect height="2" width="2" x="9" y="9" />
            <rect height="2" width="2" x="9" y="1" />
            <rect height="2" width="2" x="7" y="3" />
            <rect height="2" width="2" x="3" y="7" />
            <rect height="2" width="2" x="1" y="9" />
          </>
        ) : (
          <>
            <rect height="2" width="10" x="1" y="2" />
            <rect height="2" width="10" x="1" y="5" />
            <rect height="2" width="10" x="1" y="8" />
          </>
        )}
      </g>
    </svg>
  );
}

interface MobileMenuProps {
  /** Panel content (rendered on the server): anchor links, language, music. */
  children: ReactNode;
  /** Accessible name of the burger button. */
  label: string;
}

/**
 * Burger button and drop-down panel for phones and tablets (below `xl`). The panel hangs under
 * the sticky header; it closes on Escape (focus returns to the button), on a tap outside, when
 * a link inside it is followed, and when the window grows to the desktop layout.
 */
export function MobileMenu({ children, label }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest("a")) {
        setOpen(false);
      }
    };
    panel.addEventListener("click", onClick);
    return () => panel.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !(
          panelRef.current?.contains(target) ||
          buttonRef.current?.contains(target)
        )
      ) {
        setOpen(false);
      }
    };
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onResize = () => {
      if (desktop.matches) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    desktop.addEventListener("change", onResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      desktop.removeEventListener("change", onResize);
    };
  }, [open]);

  return (
    <>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={label}
        className="menu-btn xl:hidden"
        onClick={() => setOpen((value) => !value)}
        ref={buttonRef}
        type="button"
      >
        <BurgerIcon open={open} />
      </button>
      <div
        className="menu-panel xl:hidden"
        hidden={!open}
        id={panelId}
        ref={panelRef}
      >
        {children}
      </div>
    </>
  );
}
