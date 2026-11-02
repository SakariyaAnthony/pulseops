"""Initial PulseOps schema.

Revision ID: 001_initial
Revises:
Create Date: 2026-10-18

"""

from alembic import op

revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None


RELATIONAL = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        owner_id UUID NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS environments (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        UNIQUE (project_id, name)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        demo_token TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        revoked_at TIMESTAMPTZ
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS alert_rules (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        environment TEXT,
        name TEXT NOT NULL,
        metric TEXT NOT NULL,
        operator TEXT NOT NULL,
        threshold DOUBLE PRECISION NOT NULL,
        window_size TEXT NOT NULL,
        severity TEXT NOT NULL,
        channels JSONB NOT NULL DEFAULT '[]'::jsonb,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS alert_incidents (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
        environment TEXT,
        status TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        ack_note TEXT,
        started_at TIMESTAMPTZ NOT NULL,
        acked_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS alert_incidents_project_status_idx
        ON alert_incidents (project_id, status, started_at DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS deploys (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        env TEXT NOT NULL,
        service TEXT,
        version TEXT NOT NULL,
        commit_sha TEXT,
        deployed_at TIMESTAMPTZ NOT NULL
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS deploys_project_time_idx
        ON deploys (project_id, deployed_at DESC)
    """,
]

HYPERTABLES = [
    """
    CREATE TABLE IF NOT EXISTS request_metrics (
        time TIMESTAMPTZ NOT NULL,
        project_id UUID NOT NULL,
        env TEXT NOT NULL,
        service TEXT NOT NULL,
        host TEXT,
        method TEXT NOT NULL,
        route TEXT NOT NULL,
        status_code SMALLINT NOT NULL,
        duration_ms REAL NOT NULL,
        trace_id TEXT,
        version TEXT,
        weight INTEGER NOT NULL DEFAULT 1 CHECK (weight > 0)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS resource_metrics (
        time TIMESTAMPTZ NOT NULL,
        project_id UUID NOT NULL,
        env TEXT NOT NULL,
        service TEXT,
        host TEXT,
        cpu_pct REAL,
        mem_rss_mb REAL,
        heap_used_mb REAL,
        disk_read_bps BIGINT,
        disk_write_bps BIGINT,
        net_in_bps BIGINT,
        net_out_bps BIGINT,
        event_loop_lag_ms REAL,
        gc_pause_ms REAL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS error_events (
        time TIMESTAMPTZ NOT NULL,
        project_id UUID NOT NULL,
        env TEXT NOT NULL,
        service TEXT,
        fingerprint TEXT NOT NULL,
        type TEXT,
        message TEXT,
        stack TEXT,
        route TEXT,
        trace_id TEXT,
        context JSONB
    )
    """,
]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
    for statement in RELATIONAL + HYPERTABLES:
        op.execute(statement)

    # Hypertables and continuous aggregates cannot share the open migration transaction.
    with op.get_context().autocommit_block():
        op.execute("SELECT create_hypertable('request_metrics', 'time', if_not_exists => TRUE)")
        op.execute("SELECT create_hypertable('resource_metrics', 'time', if_not_exists => TRUE)")
        op.execute("SELECT create_hypertable('error_events', 'time', if_not_exists => TRUE)")
        op.execute(
            """
            CREATE INDEX IF NOT EXISTS request_metrics_lookup_idx
                ON request_metrics (project_id, service, route, time DESC)
            """
        )
        op.execute(
            """
            CREATE INDEX IF NOT EXISTS resource_metrics_lookup_idx
                ON resource_metrics (project_id, time DESC)
            """
        )
        op.execute(
            """
            CREATE INDEX IF NOT EXISTS error_events_lookup_idx
                ON error_events (project_id, fingerprint, time DESC)
            """
        )
        op.execute(
            """
            CREATE MATERIALIZED VIEW IF NOT EXISTS request_metrics_1m
            WITH (timescaledb.continuous) AS
            SELECT
                time_bucket('1 minute', time) AS bucket,
                project_id,
                env,
                service,
                method,
                route,
                sum(weight) AS calls,
                sum(duration_ms * weight) AS sum_ms,
                max(duration_ms) AS max_ms,
                sum(CASE WHEN status_code >= 200 AND status_code < 300 THEN weight ELSE 0 END) AS s2xx,
                sum(CASE WHEN status_code >= 300 AND status_code < 400 THEN weight ELSE 0 END) AS s3xx,
                sum(CASE WHEN status_code >= 400 AND status_code < 500 THEN weight ELSE 0 END) AS s4xx,
                sum(CASE WHEN status_code >= 500 THEN weight ELSE 0 END) AS s5xx,
                sum(CASE WHEN duration_ms <= 500 THEN weight ELSE 0 END) AS satisfied,
                sum(CASE WHEN duration_ms > 500 AND duration_ms <= 2000 THEN weight ELSE 0 END) AS tolerating,
                sum(CASE WHEN duration_ms <= 50 THEN weight ELSE 0 END) AS b50,
                sum(CASE WHEN duration_ms <= 100 THEN weight ELSE 0 END) AS b100,
                sum(CASE WHEN duration_ms <= 200 THEN weight ELSE 0 END) AS b200,
                sum(CASE WHEN duration_ms <= 300 THEN weight ELSE 0 END) AS b300,
                sum(CASE WHEN duration_ms <= 500 THEN weight ELSE 0 END) AS b500,
                sum(CASE WHEN duration_ms <= 800 THEN weight ELSE 0 END) AS b800,
                sum(CASE WHEN duration_ms <= 1000 THEN weight ELSE 0 END) AS b1000,
                sum(CASE WHEN duration_ms <= 2000 THEN weight ELSE 0 END) AS b2000,
                sum(CASE WHEN duration_ms <= 5000 THEN weight ELSE 0 END) AS b5000
            FROM request_metrics
            GROUP BY bucket, project_id, env, service, method, route
            WITH NO DATA
            """
        )
        op.execute(
            "ALTER MATERIALIZED VIEW request_metrics_1m SET (timescaledb.materialized_only = false)"
        )
        op.execute(
            """
            SELECT add_continuous_aggregate_policy(
                'request_metrics_1m',
                start_offset => INTERVAL '3 hours',
                end_offset => INTERVAL '1 minute',
                schedule_interval => INTERVAL '1 minute',
                if_not_exists => TRUE
            )
            """
        )
        op.execute(
            """
            SELECT add_retention_policy(
                'request_metrics', INTERVAL '7 days', if_not_exists => TRUE
            )
            """
        )
        op.execute(
            """
            SELECT add_retention_policy(
                'resource_metrics', INTERVAL '7 days', if_not_exists => TRUE
            )
            """
        )
        op.execute(
            """
            SELECT add_retention_policy(
                'error_events', INTERVAL '30 days', if_not_exists => TRUE
            )
            """
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "SELECT remove_continuous_aggregate_policy('request_metrics_1m', if_exists => TRUE)"
        )
        op.execute("SELECT remove_retention_policy('request_metrics', if_exists => TRUE)")
        op.execute("SELECT remove_retention_policy('resource_metrics', if_exists => TRUE)")
        op.execute("SELECT remove_retention_policy('error_events', if_exists => TRUE)")
        op.execute("DROP MATERIALIZED VIEW IF EXISTS request_metrics_1m")
    op.execute("DROP TABLE IF EXISTS error_events")
    op.execute("DROP TABLE IF EXISTS resource_metrics")
    op.execute("DROP TABLE IF EXISTS request_metrics")
    op.execute("DROP TABLE IF EXISTS deploys")
    op.execute("DROP TABLE IF EXISTS alert_incidents")
    op.execute("DROP TABLE IF EXISTS alert_rules")
    op.execute("DROP TABLE IF EXISTS api_keys")
    op.execute("DROP TABLE IF EXISTS environments")
    op.execute("DROP TABLE IF EXISTS projects")
    op.execute("DROP TABLE IF EXISTS users")
