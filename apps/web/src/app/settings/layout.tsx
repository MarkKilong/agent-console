import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/** Two columns like the shell: a narrow rail, then a breadcrumb bar over the section. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-bg">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex h-11 shrink-0 items-center px-3 text-sm font-medium tracking-tight">
          agent console
        </div>

        <nav className="min-h-0 flex-1 px-2 py-1">
          <span className="flex h-8 items-center rounded-lg bg-white/[0.09] px-2.5 text-sm font-medium text-fg">
            Providers
          </span>
        </nav>

        <div className="border-t border-line p-2">
          <Button asChild variant="ghost" className="w-full justify-start px-2">
            <Link href="/">
              <ArrowLeft />
              Back
            </Link>
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4 text-xs text-muted-foreground">
          <span>Settings</span>
          <span className="text-muted-foreground/40">/</span>
          <span className="font-medium text-fg">Providers</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-8">{children}</div>
      </div>
    </div>
  );
}
