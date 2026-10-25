import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  PageError,
  toast,
} from '@ploykit/ui';
import { useApi } from '@ploykit/hooks';

interface AdminSettingsEnvelope {
  effective: Record<string, string>;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : '未知错误';
}

// 菜单显隐卡：AdminSettingsPage children 缝的 example 接线
// （shuijing 2026-10-25 批）。shell_nav_hidden 是框架内建键，但框架页没有
// 它的专属卡——菜单结构是产品壳的事，框架不知道产品有哪些菜单项。产品用
// children 在同一页补一张自己的卡；数据源与框架页共用同一信封与查询键。
// 输入形态即后端校验形态：JSON 字符串数组（元素为菜单路径）。
export function NavVisibilityCard() {
  const api = useApi();
  const qc = useQueryClient();

  const settingsQ = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<AdminSettingsEnvelope>('/api/admin/settings'),
  });

  const [value, setValue] = useState('');
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const eff = settingsQ.data?.effective;
    if (!eff || hydrated) return;
    setValue(eff.shell_nav_hidden ?? '');
    setHydrated(true);
  }, [settingsQ.data, hydrated]);

  const saveM = useMutation({
    mutationFn: () =>
      api.put('/api/admin/settings/shell_nav_hidden', {
        value: value.trim(),
      }),
    onSuccess: () => {
      toast.success('菜单显隐已保存（刷新页面后生效）');
      void qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: (e) => {
      toast.error(`菜单显隐保存失败：${errMessage(e)}`, { duration: 8000 });
    },
  });

  if (settingsQ.isError) {
    return (
      <PageError
        message={`设置加载失败：${errMessage(settingsQ.error)}`}
        onRetry={() => void settingsQ.refetch()}
      />
    );
  }

  // 非法 JSON：徽标如实显示未保存形态，保存由后端 400 拒绝并提示
  let hiddenCount = 0;
  try {
    const parsed = value.trim() ? (JSON.parse(value) as unknown) : [];
    hiddenCount = Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    hiddenCount = -1;
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>产品壳</CardDescription>
        <CardTitle>侧边栏菜单显隐</CardTitle>
        <CardAction>
          <Badge variant={hiddenCount > 0 ? 'secondary' : 'outline'}>
            {hiddenCount > 0 ? `隐藏 ${hiddenCount} 项` : '全部显示'}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          JSON 字符串数组，元素为菜单路径（如
          <code className="mx-1 font-mono text-xs">['/realtime']</code>
          ）；空 = 全部显示。刷新页面后生效。
        </p>
        <FormField label="隐藏的菜单路径" htmlFor="shell-nav-hidden">
          <Input
            id="shell-nav-hidden"
            className="font-mono"
            placeholder='["/realtime", "/settings/workspace/schedules"]'
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={hiddenCount < 0 || undefined}
          />
        </FormField>
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={saveM.isPending || !hydrated}
            onClick={() => saveM.mutate()}
          >
            {saveM.isPending ? '保存中…' : '保存菜单显隐'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
