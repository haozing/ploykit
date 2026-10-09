package blog

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Post struct {
	Slug      string    `json:"slug"`
	Title     string    `json:"title"`
	Excerpt   string    `json:"excerpt"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

const cols = `slug, title, excerpt, content, created_at`

func List(ctx context.Context, pool *pgxpool.Pool) ([]Post, error) {
	rows, err := pool.Query(ctx, `SELECT `+cols+` FROM blog_post ORDER BY created_at DESC, slug`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Post
	for rows.Next() {
		var p Post
		if err := rows.Scan(&p.Slug, &p.Title, &p.Excerpt, &p.Content, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func BySlug(ctx context.Context, pool *pgxpool.Pool, slug string) (Post, bool, error) {
	var p Post
	err := pool.QueryRow(ctx, `SELECT `+cols+` FROM blog_post WHERE slug = $1`, slug).
		Scan(&p.Slug, &p.Title, &p.Excerpt, &p.Content, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Post{}, false, nil
	}
	if err != nil {
		return Post{}, false, err
	}
	return p, true, nil
}

func Seed(ctx context.Context, pool *pgxpool.Pool) error {
	posts := []Post{
		{
			Slug:  "hello-renderx",
			Title: "标记 static，得到完整 HTML",
			Excerpt: "在 routes.tsx 里给路由标上 render: 'static'，Go 侧注册一个 Loader——" +
				"爬虫和用户拿到的就是带 <title> 与正文的服务端渲染 HTML，单二进制直出。",
			Content: "ploykit 渲染层把『静态化』收敛成路由表里的一行配置：/blog/:slug 标记 render: 'static'，" +
				"Go 侧注册 blog.BySlug 取数，其余交给框架。\n\n" +
				"构建期（cmd/render prerender）用 esbuild 把 entry-server.tsx 打成单文件 IIFE，" +
				"喂进内嵌的 QuickJS 沙箱（wazero，零 CGo）渲染成 HTML；无 Loader 的页面（如首页）直接预渲染进 embed，" +
				"有 Loader 的页面运行期按需渲染并落分层缓存。\n\n" +
				"你此刻看到的这篇页面，就是运行期现场渲染的产物：响应里有 <title>（useSEO 注入）、" +
				"article 正文、__PLOYKIT_PROPS__ props script 和 hydrate 入口——零 Node 进程。",
		},
		{
			Slug:  "quickjs-inside",
			Title: "单二进制里的 QuickJS",
			Excerpt: "渲染引擎是 vendor 进 platform/renderx 的 QuickJS（wazero 移植）：启动 ~7ms、求值 ~53ms、" +
				"单页渲染 ~1ms——CGO_ENABLED=0 之下唯一的单二进制 SSR 方案。",
			Content: "为什么不用 Node sidecar：部署模型要求『make build 产出一个 app.exe』，进程内渲染是硬约束。\n\n" +
				"M0 三候选实测定版 Gaurav-Gosain/quickjs（buke API 的 wazero 移植）：内存上限有效、" +
				"零 CGo、渲染 1.0ms median；fork 补了槽位泄漏/64KB 截断/ForceClose 三个补丁。\n\n" +
				"沙箱不注入 fetch/window/document——页面渲染期摸 window 会在构建期预渲染时爆炸（A1 断言），" +
				"永不静默给爬虫发空页。数据一律走 Go Loader，渲染是 (组件, props) → HTML 的纯函数。",
		},
	}
	for _, p := range posts {
		if _, err := pool.Exec(ctx,
			`INSERT INTO blog_post (slug, title, excerpt, content) VALUES ($1, $2, $3, $4)
			 ON CONFLICT (slug) DO NOTHING`,
			p.Slug, p.Title, p.Excerpt, p.Content,
		); err != nil {
			return err
		}
	}
	return nil
}
