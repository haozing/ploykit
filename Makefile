.PHONY: verify verify-ui test-db check-api

check-api:
	python tools/check_api.py

verify: check-api
	go build ./... && go vet ./... && go test ./...

test-db:
	TEST_DATABASE_URL=postgres://pk:pk@localhost:5437/pk?sslmode=disable go test -p 1 ./...

verify-ui:
	cd packages/ui && npx vitest run
