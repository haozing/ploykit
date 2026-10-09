package wswire

import (
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	testScopeA = "widget"
	testScopeB = "gadget_v2"
	testCapA   = "widget_cap"
	testCapB   = "gadget_cap"
)

func TestRegisterScopeValidation(t *testing.T) {
	tests := []struct {
		name  string
		scope string
		ok    bool
	}{
		{"合法小写词", testScopeA, true},
		{"下划线与数字", testScopeB, true},
		{"空串", "", false},
		{"大写", "Demo", false},
		{"数字开头", "1demo", false},
		{"下划线开头", "_demo", false},
		{"连字符", "work-item", false},
		{"点号", "a.b", false},
		{"空格", "a b", false},
		{"超长", strings.Repeat("a", nameMaxLen+1), false},
		{"框架保留 workspace", ScopeWorkspace, false},
		{"框架保留 user", ScopeUser, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := RegisterScope(tt.scope)
			if !tt.ok {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.True(t, IsRegisteredScope(tt.scope))
		})
	}

	t.Run("重复注册报错", func(t *testing.T) {
		require.Error(t, RegisterScope(testScopeA))
	})
}

func TestRegisterCapabilityValidation(t *testing.T) {
	tests := []struct {
		name string
		cap  string
		ok   bool
	}{
		{"合法小写词", testCapA, true},
		{"下划线数字", testCapB, true},
		{"空串", "", false},
		{"大写", "Widget", false},
		{"连字符", "work-item", false},
		{"框架保留 batch", CapBatch, false},
		{"框架保留 notification", CapNotification, false},
		{"框架保留 workspace", CapWorkspace, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := RegisterCapability(tt.cap)
			if !tt.ok {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
		})
	}

	t.Run("重复注册报错", func(t *testing.T) {
		require.Error(t, RegisterCapability(testCapA))
	})
}

func TestCapabilitiesBuiltinPlusRegistered(t *testing.T) {
	got := Capabilities()

	require.Equal(t, []string{CapBatch, CapNotification, CapWorkspace}, got[:3])
	assert.True(t, slices.IsSorted(got[3:]))
	assert.Contains(t, got, testCapA)
	assert.Contains(t, got, testCapB)

	assert.Equal(t, got, Capabilities())
}

func TestIsRegisteredScopeExcludesBuiltins(t *testing.T) {
	assert.False(t, IsRegisteredScope(ScopeWorkspace), "框架保留名不算产品注册 scope")
	assert.False(t, IsRegisteredScope(ScopeUser))
	assert.False(t, IsRegisteredScope("never_registered"), "未注册 scope 为 false")
	assert.True(t, IsRegisteredScope(testScopeA))
}
