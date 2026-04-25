import type { Metadata } from 'next';
import './globals.css';
import { themeScript } from './theme';

export const metadata: Metadata = {
  title: 'Smart To-Do List',
  description: 'Decomposição de tarefas com IA e gerenciamento de tarefas.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
