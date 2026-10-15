"use client";

import { useEffect, useRef, useState } from "react";
import { MusicToggle } from "./music-toggle";
import { VolumeSlider } from "./volume-slider";

/**
 * Header speaker with a small volume popover. The popover opens while the mouse rests on the
 * control, while focus is inside it (keyboard), and after the music is switched on by a tap
 * (touch has no hover); it closes on Escape, when focus leaves, or on a tap outside. The slider
 * follows the button in tab order, so keyboard users reach it with Tab.
 */
export function MusicControl() {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = !dismissed && (hover || focus || pinned);

  useEffect(() => {
    const root = ref.current;
    if (!root) {
      return;
    }
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === "mouse") {
        setHover(true);
        setDismissed(false);
      }
    };
    const onLeave = (event: PointerEvent) => {
      if (event.pointerType === "mouse") {
        setHover(false);
      }
    };
    const onFocusIn = () => setFocus(true);
    const onFocusOut = (event: FocusEvent) => {
      if (!root.contains(event.relatedTarget as Node | null)) {
        setFocus(false);
        setPinned(false);
        setDismissed(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDismissed(true);
        setPinned(false);
        root.querySelector("button")?.focus();
      }
    };
    root.addEventListener("pointerenter", onEnter);
    root.addEventListener("pointerleave", onLeave);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("pointerenter", onEnter);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // A tap outside closes a popover that was opened by switching the music on.
  useEffect(() => {
    if (!pinned) {
      return;
    }
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setPinned(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pinned]);

  return (
    <div className="music-ctl" ref={ref}>
      <MusicToggle
        className="px-1"
        onToggle={(turningOn) => {
          setPinned(turningOn);
          setDismissed(false);
        }}
      />
      <div className="music-pop" hidden={!open}>
        <VolumeSlider />
      </div>
    </div>
  );
}
