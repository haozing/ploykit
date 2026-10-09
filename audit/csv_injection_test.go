package audit

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCSVCell_FormulaInjectionEscape_AD3(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"等号（=HYPERLINK）", `=HYPERLINK("http://evil","x")`, `'=HYPERLINK("http://evil","x")`},
		{"加号（DDE 载荷）", `+cmd|'/c calc'!A1`, `'+cmd|'/c calc'!A1`},
		{"减号（算术首字母）", `-2+3+cmd|' /C calc'!A0`, `'-2+3+cmd|' /C calc'!A0`},
		{"at 符号（Excel 表达式）", `@SUM(A1:A9)`, `'@SUM(A1:A9)`},
		{"制表符前缀（tab 欺骗）", "\t=1+1", "'\t=1+1"},
		{"回车前缀（CR 欺骗）", "\r=1+1", "'\r=1+1"},
		{"空串不动", "", ""},
		{"普通值不动", "hello, world", "hello, world"},
		{"负载在中间不动（单元格首字符才是公式判定位）", `a=1`, `a=1`},
		{"前导空格不动（非公式前缀）", " =1+1", " =1+1"},
		{"jsonb 文本形态不动（恒以 { 开头）", `{"k":"=1+1"}`, `{"k":"=1+1"}`},
		{"中文正常", "工作区名", "工作区名"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, CSVCell(tc.in))
		})
	}
}
