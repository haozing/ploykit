package storagex

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestURLRoundTrip(t *testing.T) {
	l, err := NewLocal(t.TempDir())
	require.NoError(t, err)

	key := "a%b/c?d/e#f g.txt"
	raw := l.URL(key)
	assert.NotContains(t, raw, "?", "P2-12：? 必须转义（否则被当查询串）")
	assert.NotContains(t, raw, "#", "P2-12：# 必须转义（否则被当锚点截断）")
	assert.True(t, strings.HasSuffix(raw, "a%25b/c%3Fd/e%23f%20g.txt"), "got %q", raw)

	u, err := url.Parse(raw)
	require.NoError(t, err)
	var segs []string
	rest := strings.TrimPrefix(u.EscapedPath(), "/uploads/")
	for _, s := range strings.Split(rest, "/") {
		d, err := url.PathUnescape(s)
		require.NoError(t, err)
		segs = append(segs, d)
	}
	assert.Equal(t, key, strings.Join(segs, "/"), "转义必须无损往返")

	be := &S3Backend{PublicBase: "https://cdn.example/base", Prefix: "p/"}
	s3u := be.URL(key)
	assert.Equal(t, "https://cdn.example/base/p/a%25b/c%3Fd/e%23f%20g.txt", s3u)
}

func TestValidKeyAdversarial(t *testing.T) {
	for _, k := range []string{"CON", "con", "CON.txt", "NUL.log", "com1", "LPT9.bin", "ws/COM1/x", "a.txt.", "a ", "dir/x.", "dir/x y "} {
		assert.False(t, ValidKey(k), "  %q 应被拒绝（保留名/尾点尾空格）", k)
	}
	for _, k := range []string{"index.html", "ws/2026/a.txt", "a..b", "com", "COM10", "a.b.c.txt"} {
		assert.True(t, ValidKey(k), "  %q 应合法", k)
	}
}

func TestDeleteBlobFirstKeepsMeta(t *testing.T) {
	root := t.TempDir()
	l, _ := NewLocal(root)
	ctx := context.Background()
	_, err := l.Put(ctx, "d/x.txt", "text/plain", strings.NewReader("body"))
	require.NoError(t, err)

	p := filepath.Join(root, "d", "x.txt")
	require.NoError(t, os.Remove(p))
	require.NoError(t, os.MkdirAll(filepath.Join(p, "child"), 0o755))
	require.Error(t, l.Delete(ctx, "d/x.txt"), "非空目录的 os.Remove 必败（占用等价）")
	_, statErr := os.Stat(p + ".meta.json")
	assert.NoError(t, statErr, "blob 删除失败时 meta 必须保留（可观测孤儿）")
}

func TestDeleteCleansOrphanMeta(t *testing.T) {
	root := t.TempDir()
	l, _ := NewLocal(root)
	ctx := context.Background()
	_, err := l.Put(ctx, "d/x.txt", "text/plain", strings.NewReader("body"))
	require.NoError(t, err)
	p := filepath.Join(root, "d", "x.txt")
	require.NoError(t, os.Remove(p))

	require.NoError(t, l.Delete(ctx, "d/x.txt"), "blob 缺失 + meta 孤儿：幂等清理")
	_, err = os.Stat(p + ".meta.json")
	assert.True(t, os.IsNotExist(err), "孤儿 meta 一并清掉")
}

func TestMetaAtomicNoResidue(t *testing.T) {
	root := t.TempDir()
	l, _ := NewLocal(root)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		_, err := l.Put(ctx, fmt.Sprintf("d/f%d.txt", i), "text/plain", strings.NewReader("x"))
		require.NoError(t, err)
	}
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		require.NoError(t, err)
		base := filepath.Base(p)
		assert.NotContains(t, base, ".meta-", "不得残留 meta 临时文件：%s", p)
		assert.NotContains(t, base, ".upload-", "不得残留 upload 临时文件：%s", p)
		return nil
	})
	m, err := l.LoadMeta("d/f0.txt")
	require.NoError(t, err)
	assert.Equal(t, int64(1), m.Size)
}

func TestSymlinkEscapeRejected(t *testing.T) {
	root := t.TempDir()
	l, err := NewLocal(root)
	require.NoError(t, err)
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "sub")); err != nil {
		t.Skipf("os.Symlink not permitted on this host: %v", err)
	}

	ctx := context.Background()
	_, err = l.Put(ctx, "sub/escape.txt", "text/plain", strings.NewReader("x"))
	require.Error(t, err, "经 symlink 出 Root 的写入必须被拒")
	_, _, err = l.Open(ctx, "sub/escape.txt")
	assert.Error(t, err)
	err = l.Delete(ctx, "sub/escape.txt")
	assert.Error(t, err)

	_, err = l.Put(ctx, "ok/key.txt", "text/plain", strings.NewReader("x"))
	assert.NoError(t, err)
}

type fakeAPIErr struct{ code string }

func (e fakeAPIErr) Error() string                 { return "fake: " + e.code }
func (e fakeAPIErr) ErrorCode() string             { return e.code }
func (e fakeAPIErr) ErrorMessage() string          { return "fake message" }
func (e fakeAPIErr) ErrorFault() smithy.ErrorFault { return smithy.FaultClient }

func TestMapS3Err(t *testing.T) {
	assert.True(t, errors.Is(mapS3Err(&types.NoSuchKey{}), os.ErrNotExist))
	assert.True(t, errors.Is(mapS3Err(fmt.Errorf("get: %w", &types.NoSuchKey{})), os.ErrNotExist))
	assert.True(t, errors.Is(mapS3Err(fmt.Errorf("get: %w", fakeAPIErr{code: "NoSuchKey"})), os.ErrNotExist))
	assert.True(t, errors.Is(mapS3Err(fmt.Errorf("get: %w", fakeAPIErr{code: "NotFound"})), os.ErrNotExist))
	assert.False(t, errors.Is(mapS3Err(fakeAPIErr{code: "AccessDenied"}), os.ErrNotExist))
	assert.Nil(t, mapS3Err(nil))
}

func TestPresignTTLValidation(t *testing.T) {

	client := s3.New(s3.Options{
		Region:      "us-east-1",
		Credentials: credentials.NewStaticCredentialsProvider("ak", "sk", ""),
	})
	be := &S3Backend{Client: client, Presigner: s3.NewPresignClient(client), Bucket: "b"}

	for _, ttl := range []time.Duration{0, -time.Second, 8 * 24 * time.Hour} {
		_, err := be.Presign(context.Background(), "a/b.txt", ttl)
		require.Error(t, err, "ttl=%s 必须报错", ttl)
	}
	u, err := be.Presign(context.Background(), "a/b.txt", 5*time.Minute)
	require.NoError(t, err)
	assert.Contains(t, u, "X-Amz-Signature")
}

func TestNewS3CredsValidation(t *testing.T) {
	_, err := NewS3(context.Background(), S3Options{Bucket: "b", AccessKey: "ak"})
	require.Error(t, err, "AccessKey 无 SecretKey 构造期报错（P3-62）")

	_, err = NewS3(context.Background(), S3Options{Bucket: ""})
	require.Error(t, err)
}

func TestDispositionFor(t *testing.T) {
	assert.Equal(t, "attachment", dispositionFor("image/svg+xml"))
	assert.Equal(t, "attachment", dispositionFor("text/html; charset=utf-8"), "P3-63：html 同为脚本宿主，强制 attachment")
	assert.Equal(t, "attachment", dispositionFor("application/xhtml+xml"))
	assert.Equal(t, "inline", dispositionFor("application/json"))
	assert.Equal(t, "inline", dispositionFor("image/png"))
}
