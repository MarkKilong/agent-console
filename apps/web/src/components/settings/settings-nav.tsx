'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const SECTIONS = [
  { href: '/settings/providers', label: 'Providers' },
  { href: '/settings/configuration', label: 'Configuration' },
  { href: '/settings/project', label: 'Project' },
];

/** The settings rail; the route decides which entry reads as the current one. */
export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="min-h-0 flex-1 px-2 py-1">
      <ul className="space-y-0.5">
        {SECTIONS.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className={cn(
                'flex h-8 items-center rounded-lg px-2.5 text-sm font-medium transition-colors',
                pathname === section.href
                  ? 'bg-white/[0.09] text-fg'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-fg',
              )}
            >
              {section.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** "Settings / Providers", named after whichever section is open. */
export function SettingsBreadcrumb() {
  const pathname = usePathname();
  const current = SECTIONS.find((section) => section.href === pathname);

  return (
    <>
      <span>Settings</span>
      {current ? (
        <>
          <span className="text-muted-foreground/40">/</span>
          <span className="font-medium text-fg">{current.label}</span>
        </>
      ) : null}
    </>
  );
}
