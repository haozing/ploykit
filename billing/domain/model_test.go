package domain

import "testing"

func TestIntervalMonths(t *testing.T) {
	if IntervalMonths(IntervalMonthly) != 1 {
		t.Error("月付应折算 1 个月")
	}
	if IntervalMonths(IntervalYearly) != 12 {
		t.Error("年付应折算 12 个月")
	}
}
