# Tareas del monorepo: web/ (React) y mobile/ (Flutter).
# `make help` lista todo.

.PHONY: help install dev lint test build check mobile-assets mobile-test apk clean

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

# ── App móvil (Flutter) ─────────────────────────────────────────────────────
mobile-assets: ## Compila la web y la copia a mobile/assets/www
	bash mobile/scripts/build_web_assets.sh

mobile-test: ## flutter analyze + flutter test
	cd mobile && flutter analyze && flutter test

apk: mobile-assets ## APK de release con la web actual
	cd mobile && flutter build apk --release

# ── Todo ────────────────────────────────────────────────────────────────────
check: lint test mobile-test ## Todos los checks (lo mismo que corre CI)

clean: ## Borra los builds generados
	rm -rf web/dist mobile/assets/www
