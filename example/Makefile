.PHONY: db-up db-down backend frontend build clean

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
	rm -rf cmd/app/frontend
	cp -r web/dist cmd/app/frontend
	touch cmd/app/frontend/.placeholder
	CGO_ENABLED=0 go build -o app.exe ./cmd/app
	@echo "✅ 构建完成: ./app.exe (打开 http://localhost:8080)"

clean:
	rm -rf web/dist cmd/app/frontend app.exe renderx-cache
