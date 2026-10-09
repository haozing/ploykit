package storagex

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLocalPutOpenDelete(t *testing.T) {
	l, err := NewLocal(t.TempDir())
	require.NoError(t, err)
	ctx := context.Background()

	obj, err := l.Put(ctx, "ws1/2026/a.txt", "text/plain", strings.NewReader("hello world"))
	require.NoError(t, err)
	assert.Equal(t, int64(len("hello world")), obj.Size)
	assert.Len(t, obj.SHA256, 64)

	rc, got, err := l.Open(ctx, "ws1/2026/a.txt")
	require.NoError(t, err)
	b, _ := io.ReadAll(rc)
	rc.Close()
	assert.Equal(t, "hello world", string(b))
	assert.Equal(t, "text/plain", got.ContentType)

	m, err := l.LoadMeta("ws1/2026/a.txt")
	require.NoError(t, err)
	assert.Equal(t, "inline", m.Disposition)
	assert.Equal(t, int64(len("hello world")), m.Size)

	require.NoError(t, l.Delete(ctx, "ws1/2026/a.txt"))
	_, _, err = l.Open(ctx, "ws1/2026/a.txt")
	assert.ErrorIs(t, err, os.ErrNotExist)

	require.NoError(t, l.Delete(ctx, "ws1/2026/a.txt"))
}

func TestLocalSVGForcedAttachment(t *testing.T) {
	l, _ := NewLocal(t.TempDir())
	ctx := context.Background()
	_, err := l.Put(ctx, "evil.svg", "image/svg+xml", strings.NewReader("<svg onload=alert(1)>"))
	require.NoError(t, err)
	m, err := l.LoadMeta("evil.svg")
	require.NoError(t, err)
	assert.Equal(t, "attachment", m.Disposition, "SVG forced attachment (06 storagex)")
}

func TestLocalPathEscapeRejected(t *testing.T) {
	l, _ := NewLocal(t.TempDir())
	ctx := context.Background()
	for _, key := range []string{"../escape.txt", "a/../../b.txt", "/abs.txt", "..\\win.txt", "a//b", "."} {
		_, err := l.Put(ctx, key, "text/plain", strings.NewReader("x"))
		assert.Error(t, err, "key %q should be rejected", key)
	}

	_, err := l.Put(ctx, "ok/key.txt", "text/plain", strings.NewReader("x"))
	assert.NoError(t, err)
}

func TestValidKey(t *testing.T) {
	for _, k := range []string{"a", "a/b/c", "ws/2026/01/file.bin"} {
		assert.True(t, ValidKey(k), "  %q should be valid", k)
	}
	for _, k := range []string{"", "/a", "a/", "..", "a/../b", "a\\b", "a:b", strings.Repeat("x", 513)} {
		assert.False(t, ValidKey(k), "  %q should be invalid", k)
	}
}

func TestS3BackendAgainstMinIO(t *testing.T) {
	const endpoint = "http://localhost:59000"
	req, err := http.NewRequest(http.MethodGet, endpoint+"/minio/health/live", nil)
	if err != nil {
		t.Skip("minio probe construction failed")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Skip("MinIO unreachable (minio not started)")
	}
	resp.Body.Close()

	ctx, contextCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer contextCancel()

	bucket := "storagex-test-" + time.Now().Format("150405.000000000")
	cl, err := NewS3(ctx, S3Options{
		Endpoint: endpoint, Region: "us-east-1",
		AccessKey: "minioadmin", SecretKey: "minioadmin",
		Bucket: bucket, PathStyle: true,
	})
	require.NoError(t, err)

	_, err = cl.Client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(bucket)})
	require.NoError(t, err)
	defer func() { _, _ = cl.Client.DeleteBucket(ctx, &s3.DeleteBucketInput{Bucket: aws.String(bucket)}) }()

	obj, err := cl.Put(ctx, "ws1/doc.txt", "text/plain", bytes.NewReader([]byte("s3 roundtrip")))
	require.NoError(t, err)
	assert.Len(t, obj.SHA256, 64)

	rc, got, err := cl.Open(ctx, "ws1/doc.txt")
	require.NoError(t, err)
	defer rc.Close()
	b, _ := io.ReadAll(rc)
	assert.Equal(t, "s3 roundtrip", string(b))
	assert.Equal(t, "text/plain", got.ContentType)

	url, err := cl.Presign(ctx, "ws1/doc.txt", 5*time.Minute)
	require.NoError(t, err)
	assert.Contains(t, url, "X-Amz-Signature")

	require.NoError(t, cl.Delete(ctx, "ws1/doc.txt"))
	_, _, err = cl.Open(ctx, "ws1/doc.txt")
	require.Error(t, err, "read should fail after deletion")

	assert.ErrorIs(t, err, os.ErrNotExist, "S3 Open 缺失键必须映射到 os.ErrNotExist（缓存 miss 判定契约）")
}

var (
	_ Store = (*LocalBackend)(nil)
	_ Store = (*S3Backend)(nil)
)

func TestLocalDeleteMulti(t *testing.T) {
	l, err := NewLocal(t.TempDir())
	require.NoError(t, err)
	ctx := context.Background()
	for _, k := range []string{"ws/a.txt", "ws/b.txt", "ws/c.txt"} {
		_, err := l.Put(ctx, k, "text/plain", strings.NewReader("x"))
		require.NoError(t, err)
	}

	require.NoError(t, l.DeleteMulti(ctx, "ws/a.txt", "ws/missing.txt", "ws/b.txt"))
	for _, k := range []string{"ws/a.txt", "ws/b.txt"} {
		_, _, err := l.Open(ctx, k)
		assert.Error(t, err, "  %s should be deleted", k)
	}
	rc, _, err := l.Open(ctx, "ws/c.txt")
	require.NoError(t, err, "undeleted keys kept")
	rc.Close()

	err = l.DeleteMulti(ctx, "ws/c.txt", "../escape")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "escape", "failed key names in the summary")
	_, _, err = l.Open(ctx, "ws/c.txt")
	assert.Error(t, err, "under partial failure, successful keys stay deleted (no rollback)")
}

func TestDeleteMultiHelper(t *testing.T) {
	deleted := map[string]bool{}
	del := func(_ context.Context, key string) error {
		if key == "bad" {
			return os.ErrPermission
		}
		deleted[key] = true
		return nil
	}
	require.NoError(t, deleteMulti(context.Background(), nil, del))

	err := deleteMulti(context.Background(), []string{"k1", "bad", "k2"}, del)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "bad: ", "failed keys wrap the key name")
	assert.True(t, deleted["k1"] && deleted["k2"], "failure does not block the remaining keys (delete one by one)")
}
