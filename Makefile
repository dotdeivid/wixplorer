# Tareas del monorepo: web/ (React), launcher/ (Go) y mobile/ (Flutter).
# `make help` lista todo.

.PHONY: help install dev lint test build check launcher-web launcher test-launcher desktop mobile-assets mobile-test apk clean

help: ## Lista las tareas disponibles
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

# ── Web ─────────────────────────────────────────────────────────────────────
install: ## Instala las dependencias de la web
	cd web && npm ci

dev: ## Servidor de desarrollo de la web (Vite)
	cd web && npm run dev

lint: ## ESLint de la web
	cd web && npm run lint

test: ## Tests de la web (vitest)
	cd web && npm test

build: ## Compila la web en web/dist
	cd web && npm run build

# ── Launcher de escritorio (Go) ─────────────────────────────────────────────
launcher-web: build ## Copia web/dist a launcher/dist (lo necesita go:embed)
	rm -rf launcher/dist && cp -r web/dist launcher/dist

launcher: launcher-web ## Corre el launcher en local (abre el navegador)
	cd launcher && go run .

test-launcher: launcher-web ## go vet + go test del launcher
	cd launcher && go vet . && go test .

desktop: ## Binarios de distribución (.app + .exe) en dist_bin/
	bash scripts/build_desktop.sh

# ── App móvil (Flutter) ─────────────────────────────────────────────────────
mobile-assets: ## Compila la web y la copia a mobile/assets/www
	bash scripts/build_mobile_web.sh

mobile-test: ## flutter analyze + flutter test
	cd mobile && flutter analyze && flutter test

apk: mobile-assets ## APK de release con la web actual
	cd mobile && flutter build apk --release

# ── Todo ────────────────────────────────────────────────────────────────────
check: lint test test-launcher mobile-test ## Todos los checks (lo mismo que corre CI)

clean: ## Borra los builds generados
	rm -rf web/dist launcher/dist dist_bin mobile/assets/www
