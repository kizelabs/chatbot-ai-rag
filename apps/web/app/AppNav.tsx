"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
}

const isActivePath = (pathname: string, href: string): boolean => {
  if (pathname === href) {
    return true;
  }

  return href !== "/" && pathname.startsWith(`${href}/`);
};

export default function AppNav({ navItems }: { navItems: NavItem[] }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <div className="animate-rise sticky top-3 z-30 rounded-2xl border border-ink/20 bg-black/60 p-3 shadow-panel backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-base uppercase tracking-[0.2em] text-ink/60">Snuggly Moonbeam</p>
            <p className="text-base font-semibold">Operator Console</p>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen((value) => !value)}
            className="neon-btn rounded-lg border border-ink/20 bg-black/70 px-3 py-2 font-mono text-base uppercase tracking-[0.14em] text-ink transition hover:bg-accent/10"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
          >
            {mobileOpen ? "Close" : "Menu"}
          </button>
        </div>

        {mobileOpen ? (
          <nav id="mobile-nav" className="mt-3 grid gap-2 border-t border-ink/10 pt-3">
            {navItems.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`neon-link rounded-lg border px-3 py-2 text-base font-medium transition ${
                      active
                        ? "border-accent/40 bg-accent/20 text-ink"
                        : "border-transparent bg-black/70 text-ink hover:border-ink/20 hover:bg-black/85"
                    }`}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>
        ) : null}
      </div>

      <aside className="animate-rise hidden rounded-2xl border border-ink/20 bg-black/55 p-4 shadow-panel backdrop-blur md:p-5 lg:sticky lg:top-6 lg:block lg:h-[calc(100svh-3rem)]">
        <p className="font-mono text-base uppercase tracking-[0.2em] text-ink/65">Snuggly Moonbeam</p>
        <h1 className="mt-2 text-xl font-bold leading-tight">Operator Console</h1>
        <p className="mt-2 text-base text-ink/70">WhatsApp orchestration, model control, and incident visibility.</p>

        <nav className="mt-6 space-y-2">
          {navItems.map((item) => {
            const active = isActivePath(pathname, item.href);

            return (
              <a
                key={item.href}
                href={item.href}
                className={`neon-link block rounded-lg border px-3 py-2 text-base font-medium transition ${
                  active
                    ? "border-accent/40 bg-accent/20 text-ink"
                    : "border-transparent text-ink hover:border-ink/20 hover:bg-black/75"
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
