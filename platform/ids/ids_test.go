package ids

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

func TestNewV7_VersionBitAndMonotonicity(t *testing.T) {
	a, b := NewV7(), NewV7()
	assert.Equal(t, uuid.Version(7), a.Version(), "NewV7 必须产出 version 7（时间有序）")
	assert.Equal(t, uuid.Version(7), b.Version())
	assert.NotEqual(t, a, b, "两次调用不得同值")

	assert.GreaterOrEqual(t, uint64(b.Time()), uint64(a.Time()),
		"v7 时间戳单调不减")
}

func TestNewV4_VersionBit(t *testing.T) {
	id := NewV4()
	assert.Equal(t, uuid.Version(4), id.Version(), "NewV4 必须产出 version 4（随机）")
	assert.NotEqual(t, id, NewV4())
}
