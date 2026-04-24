import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Smart To-Do List',
  description: 'AI-powered task decomposition and task management.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
