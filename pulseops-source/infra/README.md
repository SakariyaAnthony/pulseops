# PulseOps infra

TimescaleDB (Postgres 16) and Redis for the API in `apps/api`. The Compose file also builds the API service.

```bash
docker compose up -d timescaledb redis
```

Published ports on the host:

- TimescaleDB `127.0.0.1:54329`
- Redis `127.0.0.1:63799`
- API `47322` when the `api` service is started

Database credentials for local development: user `pulseops`, password `pulseops`, database `pulseops`.

To run the API on the host instead of in a container, start only `timescaledb` and `redis`, then follow `apps/api/README.md`. Do not bind port 47322 twice.
