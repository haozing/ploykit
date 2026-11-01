.PHONY: db-up db-down backend frontend build clean test test-fast test-db

# ---- Test lanes (carried with every product cloned from this template) ----
# Gating discipline (docs/testing-strategy.md rule 8, zijianfang proposal 三):
#   test-fast is the DAILY lane (-short): heavy lanes self-skip via
#   `if testing.Short() { t.Skip("short: <reason>") }` — the reason string is
#   mandatory and review-grepable. CONTRACT / REGRESSION ANCHORS ARE NEVER
#   GATED — a fast path that skips its contract tests has no reason to exist.
#   Fast-path determinism: two test-fast runs must yield byte-identical
#   PASS/SKIP sets; per-test wall-clock guards need load headroom (hostile
#   CI neighbors cause false failures otherwise).
test:
	go test -p 1 -timeout 1500s ./...

test-fast:
	go test -short -p 1 -timeout 300s ./...

# Full lane against the dev database (make db-up first). Framework/product
# suites are DB-gated: they self-skip without TEST_DATABASE_URL.
test-db:
	TEST_DATABASE_URL=postgres://pk:pk@localhost:5437/pk?sslmode=disable \
	go test -p 1 -timeout 1500s ./...

db-up:
	docker compose up -d postgres 2>/dev/null || docker run -d --name ploykit-pg \
		-e POSTGRES_USER=pk -e POSTGRES_PASSWORD=pk -e POSTGRES_DB=pk \
		-p 5437:5432 postgres:16-alpine

db-down:
	docker rm -f ploykit-pg 2>/dev/null || true

backend:
	DATABASE_URL=postgres://pk:pk@localhost:5437/pk?sslmode=disable \
	AUTH_SECRET=dev-pepper DEV_CODE=000000 \
	go run ./cmd/app

frontend:
	cd web && npx vite --port 5173

build:
	cd web && npm run build
	go run ./cmd/render prerender
	node ../tools/precompress.mjs web/dist
	rm -rf cmd/app/frontend
	cp -r web/dist cmd/app/frontend
	touch cmd/app/frontend/.placeholder
	CGO_ENABLED=0 go build -o app.exe ./cmd/app
	@echo "✅ 构建完成: ./app.exe (打开 http://localhost:8080)"

clean:
	rm -rf web/dist cmd/app/frontend app.exe renderx-cache
