import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'PloyKit Admin',
    template: '%s - PloyKit Admin',
  },
  description: 'PloyKit admin operations console.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
