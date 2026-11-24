# The community registry (plan phase 9) — the deployable package.
#
#   docker build -f server/Dockerfile -t printninja-server .
#   docker run -p 8787:8787 -v registry-data:/data printninja-server
#
# The database lives in the /data volume; the migration files are part
# of the image, so a deployment always knows exactly which schema it
# runs. The terminal commands (`migrate make/apply/status`, `db reset`)
# work from `docker exec printninja-server migrate status` the same way
# they work from the shell.

FROM rust:1.90-slim AS build
WORKDIR /src
# The whole repo, minus the .dockerignore exclusions. Cargo parses the
# workspace manifests but compiles only what pn-server needs (itself
# and pn-scene) — the app crate and its desktop toolchain are never
# built here.
COPY . .
RUN cargo build --release -p pn-server

FROM debian:bookworm-slim
RUN adduser --disabled-password --gecos "" printninja \
    && mkdir -p /data && chown printninja /data
WORKDIR /app
COPY --from=build /src/target/release/pn-server /app/pn-server
COPY server/migrations /app/migrations
# Starts as root only to fix the ownership of a freshly mounted volume
# (Fly and similar hosts mount /data root-owned), then runs the server
# as the printninja user.
COPY server/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh
ENV PN_SERVER_BIND=0.0.0.0:8787 \
    PN_SERVER_DB=/data/printninja-server.db \
    PN_SERVER_MIGRATIONS_DIR=/app/migrations
VOLUME ["/data"]
EXPOSE 8787
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["serve"]
