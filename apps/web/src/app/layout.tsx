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

// Renderiza a estrutura raiz da aplicação e injeta o script inicial de tema.
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
