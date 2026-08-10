# --- Frontend bauen ---
FROM node:22-alpine AS client
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Server bauen ---
FROM golang:1.25-alpine AS server
WORKDIR /src
COPY server/go.mod ./
RUN go mod download
COPY server/ ./
# Statisch gelinkt, damit das Ergebnis ohne libc auskommt.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /planr .

# --- Auslieferung ---
FROM alpine:3.21
RUN apk add --no-cache ca-certificates wget && adduser -D -u 10001 planr
COPY --from=server /planr /usr/local/bin/planr
COPY --from=client /app/dist /srv/dist

# Projekte liegen hier -- als Volume einbinden, sonst sind sie beim
# naechsten Image-Build weg.
ENV PLANR_DATA=/data \
    PLANR_STATIC=/srv/dist \
    PORT=8090
RUN mkdir -p /data && chown planr:planr /data
VOLUME ["/data"]
USER planr

EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://localhost:8090/healthz >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/planr"]
