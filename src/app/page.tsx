/**
 * 鏍归〉闈?- 閲嶅畾鍚戝埌榛樿璇█
 */
import { redirect } from 'next/navigation';
import { defaultLocale } from '@/i18n/config';

export default function RootPage() {
  //
  redirect(`/${defaultLocale}`);
}
