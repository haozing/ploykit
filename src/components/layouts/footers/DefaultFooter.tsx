/**
 * ==========================================================================
 * Default Footer Component
 * ==========================================================================
 *
 * 框架可配置的默认 Footer Layout
 *
 * 特性：
 * - 响应式 Design Tokens（颜色、边框、间距等）
 * - 支持插件扩展（Copyright、Links、Extra）
 * - 简洁的可视化 Layout
 *
 * 插槽：
 * - footer:copyright (replace) - Copyright 信息区域
 * - footer:links (replace) - 链接区域
 * - footer:extra (append) - 额外区域（多个插件可共享）
 */

import { SlotRenderer } from '@/components/SlotRenderer';
import type { LayoutComponentProps } from '@/lib/ui/layout/layout-resolver';
import { getSiteFooterNavItems } from '@/lib/ui/navigation';
import { siteConfig } from '../../../../site.config';
import { ClientFooterLinks } from './ClientFooterLinks';

/**
 * ==========================================================================
 * Default Copyright Information Component：Fallback
 * ==========================================================================
 */
function DefaultCopyright() {
  const currentYear = new Date().getFullYear();

  return (
    <div
      className="text-sm"
      style={{
        color: 'var(--footer-text)',
      }}
    >
      © {currentYear} {siteConfig.name}. All rights reserved.
    </div>
  );
}

/**
 * ==========================================================================
 * DefaultFooter Component
 * ==========================================================================
 */
export default async function DefaultFooter({ tokens }: LayoutComponentProps) {
  const footerLinks = await getSiteFooterNavItems();

  return (
    <>
      {/* 🆕 Footer before slot */}
      <SlotRenderer slotName="footer:before" mode="append" />

      <footer
        className="w-full"
        style={{
          backgroundColor: tokens.footer.bg,
          borderTop: tokens.footer.borderTop,
        }}
      >
        <div
          className="mx-auto flex flex-col md:flex-row items-center justify-between gap-4"
          style={{
            maxWidth: tokens.common.containerMaxW,
            paddingLeft: tokens.footer.paddingX,
            paddingRight: tokens.footer.paddingX,
            paddingTop: tokens.footer.paddingY,
            paddingBottom: tokens.footer.paddingY,
          }}
        >
          {/* 左侧：版权信息插槽（现有）*/}
          <SlotRenderer
            slotName="footer:copyright"
            mode="replace"
            fallback={<DefaultCopyright />}
          />

          {/* 中间/右侧：链接插槽 */}
          <div className="flex items-center gap-6">
            {/* 🆕 Links before slot */}
            <SlotRenderer slotName="footer:links-before" mode="append" />

            {/* Links 插槽（现有）*/}
            <SlotRenderer
              slotName="footer:links"
              mode="replace"
              fallback={<ClientFooterLinks links={footerLinks} />}
            />

            {/* 🆕 Links after slot */}
            <SlotRenderer slotName="footer:links-after" mode="append" />

            {/* Extra 插槽（现有）*/}
            <SlotRenderer
              slotName="footer:extra"
              mode="append"
              className="flex items-center gap-4"
            />
          </div>
        </div>
      </footer>

      {/* 🆕 Footer after slot */}
      <SlotRenderer slotName="footer:after" mode="append" />
    </>
  );
}
