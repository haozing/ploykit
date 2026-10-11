package app

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/haozing/ploykit/authz"
)

func TestCreate_MaxPerUserGuard(t *testing.T) {
	ctx := context.Background()

	newSvcWithCap := func(cap int) (*WorkspaceService, *fake) {
		f, _ := seedWS(t)
		return NewWorkspaceService(f, authz.New(nil, nil), nil, nil, WorkspaceConfig{MaxPerUser: cap}, testNow), f
	}

	t.Run("已达上限 → 402 且不建区", func(t *testing.T) {
		svc, f := newSvcWithCap(1)
		_, err := svc.Create(ctx, ownerP("alice"), "alice-ws2", "Alice 2")
		assert.Equal(t, 402, errStatus(t, err))
		if _, ok, _ := f.GetWorkspace(ctx, "ws-alice-ws2"); ok {
			t.Fatal("超额建区不应产生新工作区")
		}
	})

	t.Run("未达上限 → 正常建区", func(t *testing.T) {
		svc, f := newSvcWithCap(2)
		ws, err := svc.Create(ctx, ownerP("alice"), "alice-ws2", "Alice 2")
		require.NoError(t, err)
		if _, ok, _ := f.GetWorkspace(ctx, ws.ID); !ok {
			t.Fatal("配额内建区应成功")
		}
	})

	t.Run("上限按账号隔离", func(t *testing.T) {
		svc, f := newSvcWithCap(1)

		ws, err := svc.Create(ctx, ownerP("bob"), "bob-ws", "Bob")
		require.NoError(t, err)
		if _, ok, _ := f.GetWorkspace(ctx, ws.ID); !ok {
			t.Fatal("bob 配额独立，建区应成功")
		}
	})

	t.Run("MaxPerUser<0 不限 → 跳过配额段", func(t *testing.T) {
		svc, f := newSvcWithCap(-1)
		if _, err := svc.Create(ctx, ownerP("alice"), "alice-ws2", "Alice 2"); err != nil {
			t.Fatalf("create: %v", err)
		}
		if _, ok, _ := f.GetWorkspace(ctx, "ws-alice-ws2"); !ok {
			t.Fatal("不限装配建区应成功")
		}
	})

	t.Run("零值=不限（F10：Go 零值无害，第一个工作区不被拒）", func(t *testing.T) {
		// 零值 WorkspaceConfig{} 与 MaxPerUser:0 同义——旧行为是 0 上限拒绝一切，
		// 现为零值/负值均不限，只有显式正数才启用配额。
		svc, f := newSvcWithCap(0)
		if _, err := svc.Create(ctx, ownerP("alice"), "alice-ws2", "Alice 2"); err != nil {
			t.Fatalf("zero-value config must not block creation: %v", err)
		}
		if _, ok, _ := f.GetWorkspace(ctx, "ws-alice-ws2"); !ok {
			t.Fatal("零值配置建区应成功")
		}
	})
}
