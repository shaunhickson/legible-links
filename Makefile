.PHONY: all test test-backend test-extension lint lint-backend lint-extension build build-backend build-extension build-website docker-build clean dev backend-dev extension-dev website-dev

# Default target
all: lint test build

# --- Testing ---
test: test-backend test-extension

test-backend:
	@echo "--- Testing Backend ---"
	cd backend && go test -v -race -cover ./...

test-extension:
	@echo "--- Testing Extension ---"
	cd extension && npm test -- --run

# --- Linting ---
lint: lint-backend lint-extension lint-website

lint-backend:
	@echo "--- Linting Backend ---"
	# Requires golangci-lint installed locally
	-cd backend && golangci-lint run ./...

lint-extension:
	@echo "--- Linting Extension ---"
	cd extension && npm run lint

lint-website:
	@echo "--- Linting Website ---"
	cd website && npm run lint

# --- Building ---
build: build-backend build-extension build-website

build-backend:
	@echo "--- Building Backend ---"
	cd backend && go build -o server .

build-extension:
	@echo "--- Building Extension ---"
	cd extension && npm run build

build-website:
	@echo "--- Building Website ---"
	cd website && npm run build

# --- Docker ---
docker-build:
	@echo "--- Building Docker Image ---"
	docker build -t legible-links-backend ./backend

# --- Development ---
dev:
	@echo "Run 'make backend-dev', 'make extension-dev', and 'make website-dev' in separate terminals."

backend-dev:
	cd backend && go run .

extension-dev:
	cd extension && npm run dev

website-dev:
	cd website && npm run dev

clean:
	rm -f backend/server
	rm -rf extension/dist
	rm -rf website/.next
