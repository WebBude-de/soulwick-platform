"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type IconName, PixelIcon } from "./pixel-icon";

export interface NavItem {
  href: string;
  icon: IconName;
  label: string;
}

const isCurrent = (pathname: string, href: string) =>
  href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);

/**
 * Sidebar links with the current page marked (aria-current). Only the pathname is read here; it is
 * rendered on the server too, so the marking also works without client JavaScript.
 */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <ul className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
      {items.map((item) => (
        <li key={item.href}>
          <Link
            aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
            className="nav-link"
            href={item.href}
          >
            <span className="flex size-6 items-center justify-center">
              <PixelIcon name={item.icon} />
            </span>
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
