# Rivets 'n Ruin
#
# `make` with no target prints the list below.

BINARY      := rnr-server
BUILD_DIR   := build
DATA        := data/rnr.json
ADDR        ?= 127.0.0.1:8000
GOFILES     := $(shell find . -name '*.go' -not -path './$(BUILD_DIR)/*')
JSFILES     := $(wildcard src/*.js)
GO          ?= go
NODE        ?= node

# Strip debug info; this is a game server, not something anyone will dlv into.
LDFLAGS     := -s -w

.DEFAULT_GOAL := help
.PHONY: help run build test test-race test-js coverage bench fmt vet check js-check smoke tidy clean dist icons gallery stats

help: ## Show this help
	@echo "Rivets 'n Ruin"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "  ADDR=0.0.0.0:8000 make run    expose on your network"

run: ## Build and run the game + backend (ADDR to override the bind address)
	@$(GO) run ./cmd/server -addr $(ADDR) -data $(DATA)

build: $(BUILD_DIR)/$(BINARY) ## Compile the server binary

$(BUILD_DIR)/$(BINARY): $(GOFILES)
	@mkdir -p $(BUILD_DIR)
	$(GO) build -ldflags '$(LDFLAGS)' -o $@ ./cmd/server
	@echo "built $@"

test: ## Run the Go tests
	$(GO) test ./...

test-race: ## Run the Go tests under the race detector
	$(GO) test -race -count=1 ./...

test-js: ## Run the client-side tests
	@$(NODE) --test test/*.test.mjs

coverage: ## Coverage for both sides; prints a combined summary
	@echo "— go —"
	@$(GO) test ./... -coverprofile=$(BUILD_DIR)/go.cover -covermode=atomic >/dev/null 2>&1 || true
	@mkdir -p $(BUILD_DIR)
	@$(GO) test ./... -coverprofile=$(BUILD_DIR)/go.cover -covermode=atomic 2>&1 | grep -E 'coverage:|no test files' || true
	@$(GO) tool cover -func=$(BUILD_DIR)/go.cover | tail -1
	@echo
	@echo "— javascript —"
	@$(NODE) --test --experimental-test-coverage test/*.test.mjs 2>&1 \
		| sed -n '/start of coverage report/,/end of coverage report/p' \
		| grep -E '^# (src/|all files)' || true
	@echo
	@echo "html go report: $(GO) tool cover -html=$(BUILD_DIR)/go.cover"

bench: ## Run benchmarks, if any
	$(GO) test -run '^$$' -bench . -benchmem ./...

fmt: ## Format Go sources in place
	@gofmt -w $(GOFILES)
	@echo "formatted $(words $(GOFILES)) file(s)"

vet: ## Run go vet
	$(GO) vet ./...

# `node --check foo.js` reports success on a .js file containing ES module
# syntax even when it is genuinely unparseable — it only diagnoses correctly
# when the extension is .mjs. Every client module here is ESM in a .js file,
# so checking them directly is a gate that cannot fail. Copy to .mjs first,
# and capture node's status directly rather than through a pipe, which would
# report sed's exit code instead.
js-check: ## Syntax-check every client module (ESM-aware)
	@tmp=$$(mktemp -d); status=0; \
	for f in $(JSFILES); do \
		m="$$tmp/$$(basename $$f .js).mjs"; \
		cp "$$f" "$$m"; \
		if ! out=$$($(NODE) --check "$$m" 2>&1); then \
			echo "$$out" | sed "s|$$m|$$f|"; \
			status=1; \
		fi; \
	done; \
	rm -rf "$$tmp"; \
	if [ $$status -ne 0 ]; then exit 1; fi; \
	echo "checked $(words $(JSFILES)) module(s)"

check: ## Everything CI would run: format check, vet, race tests, JS syntax
	@unformatted=$$(gofmt -l $(GOFILES)); \
	if [ -n "$$unformatted" ]; then \
		echo "not gofmt-clean:"; echo "$$unformatted"; exit 1; \
	fi
	@echo "gofmt    ok"
	@$(GO) vet ./... && echo "vet      ok"
	@$(GO) test -race -count=1 ./... >/dev/null && echo "go test  ok (race)"
	@$(MAKE) -s js-check
	@$(NODE) --test test/*.test.mjs >/dev/null && echo "js test  ok"
	@$(MAKE) -s smoke
	@echo "all checks passed"

SMOKE_PORT ?= 8399

# Wait until the server is actually listening, rather than assuming a fixed
# number of seconds is enough. It was not: under load the binary took longer
# than the 1.5s sleep to bind, the browser got a connection refused, and the
# smoke gate failed with one assertion of nine passing — which looks like a
# catastrophic rendering regression rather than a race.
define wait_for
	for i in $$(seq 1 100); do \
		curl -sf --max-time 1 http://127.0.0.1:$(1)/api/health >/dev/null 2>&1 && break; \
		sleep 0.2; \
	done
endef

smoke: build ## Launch the game and assert it actually renders and scrolls
	@./$(BUILD_DIR)/$(BINARY) -addr 127.0.0.1:$(SMOKE_PORT) -data $(BUILD_DIR)/smoke.json & \
	pid=$$!; \
	trap "kill $$pid 2>/dev/null" EXIT; \
	$(call wait_for,$(SMOKE_PORT)); \
	$(NODE) tools/smoke.cjs http://127.0.0.1:$(SMOKE_PORT)/

tidy: ## Tidy go.mod
	$(GO) mod tidy

gallery: build ## Regenerate the README images from the live game
	@./$(BUILD_DIR)/$(BINARY) -addr 127.0.0.1:$(SMOKE_PORT) -data $(BUILD_DIR)/gallery.json & \
	pid=$$!; \
	trap "kill $$pid 2>/dev/null" EXIT; \
	$(call wait_for,$(SMOKE_PORT)); \
	$(NODE) tools/make_gallery.cjs http://127.0.0.1:$(SMOKE_PORT)/
	@python3 tools/optimise_gallery.py

icons: ## Regenerate favicon.ico and apple-touch-icon.png
	python3 tools/make_icons.py

dist: clean build ## Build a self-contained release tree in build/dist
	@mkdir -p $(BUILD_DIR)/dist
	@cp -r index.html src favicon.ico apple-touch-icon.png README.md LICENSE $(BUILD_DIR)/dist/
	@cp $(BUILD_DIR)/$(BINARY) $(BUILD_DIR)/dist/
	@echo "dist tree in $(BUILD_DIR)/dist — run ./$(BINARY) from inside it"

stats: ## Line counts, because it is nice to know
	@printf "  client js  %6s lines\n" "$$(cat $(JSFILES) | wc -l)"
	@printf "  server go  %6s lines\n" "$$(cat $(GOFILES) | wc -l)"
	@printf "  go tests   %6s lines\n" "$$(cat $$(find . -name '*_test.go') | wc -l)"

clean: ## Remove build output (leaves the data snapshot alone)
	@rm -rf $(BUILD_DIR)
	@echo "cleaned"
