"use client";

import { Children, type ReactNode, useState } from "react";

interface WishCycleProps {
  /** Label of the button that shows the next example. */
  anotherLabel: string;
  /** One server-rendered example per child; only the active one is shown. */
  children: ReactNode;
  /** Small print next to the button. */
  note: string;
}

/**
 * Cycles through the wish-boss examples: one is shown, the button brings the next one (it rises
 * from the fire, see `landing.css`). Without JavaScript the first example stays.
 */
export function WishCycle({ children, anotherLabel, note }: WishCycleProps) {
  const items = Children.toArray(children);
  const [index, setIndex] = useState(0);

  return (
    <>
      <div aria-live="polite" className="wish-current">
        {items[index % Math.max(items.length, 1)]}
      </div>
      <div className="wish-actions">
        <button
          className="btn btn-sm"
          onClick={() => setIndex((i) => (i + 1) % Math.max(items.length, 1))}
          type="button"
        >
          {anotherLabel}
        </button>
        <p className="wish-note">{note}</p>
      </div>
    </>
  );
}
