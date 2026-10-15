"use client";
import Link from "next/link";
import { useRef } from "react";
export function MobileNavigation({
  links,
}: {
  links: readonly (readonly [string, string])[];
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <details
      className="m-mobile-nav"
      ref={menu}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current) {
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary>Menu</summary>
      <nav aria-label="Mobile primary">
        {links.map(([name, href]) => (
          <Link
            key={href}
            href={href}
            onClick={() => {
              if (menu.current) menu.current.open = false;
            }}
          >
            {name}
          </Link>
        ))}
      </nav>
    </details>
  );
}
