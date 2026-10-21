import { SignInModal, toast } from '@ploykit/ui';

/**
 * 博客页的交互岛：只在用户真的点「收藏」时才加载。
 *
 * 这些内容背后是 Base UI 的 Dialog 原语与 sonner（合计约 88KB gzip），而
 * 博客页对绝大多数访客（搜索引擎进来的读者）一辈子都用不到。它们若随
 * BlogPost 一起进首包，就意味着每个读者为了一个可能不点的按钮下载一整套
 * 弹层与 toast 框架。
 *
 * 与服务端渲染的配合：岛内的组件都只在「已点击」之后才挂载（signInOpen
 * 初值是 false，两端一致），因此不会产生水合错配——服务端本来就渲染不出
 * 这些内容。
 */

export { toast };

export function SignInDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <SignInModal
      open={open}
      onOpenChange={onOpenChange}
      // 不用 passwordOnly：OAuth 注册的用户没有 password_hash（identity 的
      // UpsertUserByEmail 不写该列），纯密码形态会把这类访客挡在门外。
      // 默认的 email-first 覆盖三种用户：注册用户（有密码）、OAuth 用户
      // （只能用验证码）、以及记不清密码的（下方可切验证码）。
      title="登录后继续"
      description="登录以收藏文章到你的任务列表"
    />
  );
}
