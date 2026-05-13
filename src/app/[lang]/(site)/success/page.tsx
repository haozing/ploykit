/**
 * SubscriptionSuccess页面
 *
 * Path: /[lang]/success
 * 设计方案参考：PaymentSubscriptionSystem设计方案.md 第5节
 */

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function SuccessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [countdown, setCountdown] = useState(5);

  const sessionId = searchParams.get('session_id');

  // when自动跳转
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      router.push(`/billing`);
    }
  }, [countdown, router]);

  return (
    <div className="success-page min-h-screen flex items-center justify-center bg-muted">
      <div className="text-center max-w-md mx-auto p-8">
        {/* Success图标 */}
        <div className="mb-8">
          <div className="w-20 h-20 bg-success-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-12 h-12 text-success"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold mb-4 text-foreground">SubscriptionSuccess！</h1>
          <p className="text-muted-foreground mb-2">感谢您Subscription我们of平台</p>
          <p className="text-muted-foreground">现at您可byUseAll工具Plugin了</p>
        </div>

        {/* Session ID（调Trial） */}
        {sessionId && (
          <div className="mb-6 p-3 bg-muted rounded-lg">
            <p className="text-xs text-muted-foreground break-all">Session ID: {sessionId}</p>
          </div>
        )}

        {/* FeatureDescription */}
        <div className="mb-8 bg-card border rounded-lg p-6 text-left">
          <h2 className="font-semibold mb-3 text-foreground">您现at可by：</h2>
          <ul className="space-y-2 text-sm text-foreground">
            <li className="flex items-start">
              <span className="text-success mr-2"></span>
              <span>UseAll工具Plugin</span>
            </li>
            <li className="flex items-start">
              <span className="text-success mr-2"></span>
              <span>享受SubscriptionPlanof配额andFeature</span>
            </li>
            <li className="flex items-start">
              <span className="text-success mr-2"></span>
              <span>atBilling页面Manage您ofSubscription</span>
            </li>
          </ul>
        </div>

        {/* 行动按钮 */}
        <div className="space-y-3">
          <button
            onClick={() => router.push(`/billing`)}
            className="w-full bg-primary text-white px-8 py-3 rounded-lg hover:bg-primary font-semibold transition-colors"
          >
            查看Subscription详情
          </button>
          <button
            onClick={() => router.push(`/profile`)}
            className="w-full bg-muted text-foreground px-8 py-3 rounded-lg hover:bg-accent font-semibold transition-colors"
          >
            完善Profile
          </button>
        </div>

        {/* 自动跳转Tip */}
        <p className="text-sm text-muted-foreground mt-6">
          {countdown} second(s)后自动跳转toSubscription详情...
        </p>
      </div>
    </div>
  );
}
