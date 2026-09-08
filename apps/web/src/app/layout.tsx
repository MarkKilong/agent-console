import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'agent console',
  description: 'Chat-plus-IDE view for driving an agent runner',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
