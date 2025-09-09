# ==========================================
# PeerLink Enterprise Dockerfile
# Für Millionen User skalierbar
# ==========================================

FROM node:18-alpine AS base

# Sicherheits-Updates und Abhängigkeiten
RUN apk update && apk upgrade && \
    apk add --no-cache \
    dumb-init \
    curl \
    openssl \
    ca-certificates && \
    rm -rf /var/cache/apk/*

# Arbeitsverzeichnis erstellen
WORKDIR /app

# ==========================================
# Dependencies Stage
# ==========================================
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# ==========================================
# Build Stage
# ==========================================
FROM deps AS build
COPY . .
RUN npm run build 2>/dev/null || echo "No build script found"

# ==========================================
# Production Stage
# ==========================================
FROM base AS production

# Sicherheits-User erstellen
RUN addgroup -g 1001 -S nodejs && \
    adduser -S peerlink -u 1001

# Abhängigkeiten für Produktion kopieren
COPY --from=deps --chown=peerlink:nodejs /app/node_modules ./node_modules
COPY --chown=peerlink:nodejs . .

# Verzeichnis für Logs und Config
RUN mkdir -p /app/logs /app/config && \
    chown -R peerlink:nodejs /app

# Port freigeben
EXPOSE 8080

# Gesundheitscheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Sicherheits-Features
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"

# Als nicht-root User ausführen
USER peerlink

# Container mit dumb-init starten (für korrekte Signal-Handling)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]

