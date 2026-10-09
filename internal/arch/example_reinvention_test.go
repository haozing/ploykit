package arch

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type reinventionFeature struct {
	pattern string
	why     string
}

var exampleReinventionFeatures = []reinventionFeature{
	{
		pattern: "Access-Control-Allow-Origin",
		why:     "已有 webx.CORS（platform/webx/cors.go），禁止手写 CORS",
	},
	{

		pattern: `"workspace:"`,
		why:     "已有 wsx.WorkspaceScope（platform/wsx/register.go），禁止手拼 scope 前缀",
	},
	{

		pattern: `"23505"`,
		why:     "已有 pg.IsUniqueViolation / pg.AsDuplicate（platform/pg/pg.go），禁止手写 23505 判定",
	},
}

func TestExampleNoReinvention(t *testing.T) {
	root := filepath.Join("..", "..", "example")
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == "web" {
				return fs.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel := filepath.ToSlash(path)
		for i, line := range strings.Split(string(data), "\n") {
			for _, f := range exampleReinventionFeatures {
				if strings.Contains(line, f.pattern) {
					t.Errorf("%s:%d 命中特征 %q：%s", rel, i+1, f.pattern, f.why)
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk example: %v", err)
	}
}
