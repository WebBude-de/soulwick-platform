"use client";

import { useEffect } from "react";
import { Peekers } from "./peekers";
import { ScrollCat } from "./scroll-cat";
import { SlimeQueen } from "./slime-queen";

const KONAMI = [
  "arrowup",
  "arrowup",
  "arrowdown",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "arrowleft",
  "arrowright",
  "b",
  "a",
];
const SHADOW_REALM_MS = 10_000;

/** Konami code: 10 s of Schattenreich tint and a shadow crossing the hero's walker strip. */
function useKonami() {
  useEffect(() => {
    let index = 0;
    let timer: number | null = null;
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      index = key === KONAMI[index] ? index + 1 : Number(key === KONAMI[0]);
      if (index < KONAMI.length) {
        return;
      }
      index = 0;
      const root = document.documentElement;
      root.dataset.shadowRealm = "";
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        delete root.dataset.shadowRealm;
      }, SHADOW_REALM_MS);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, []);
}

/** Site-wide easter eggs that live above the page (fixed overlays, never move the layout). */
export function FunLayer() {
  useKonami();
  return (
    <>
      <SlimeQueen />
      <Peekers />
      <ScrollCat />
    </>
  );
}
