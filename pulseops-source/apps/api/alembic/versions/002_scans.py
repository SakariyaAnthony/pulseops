"""Scan settings and lab scan results.

Revision ID: 002_scans
Revises: 001_initial
Create Date: 2026-10-19

"""

from alembic import op

revision = "002_scans"
down_revision = "001_initial"
branch_labels = None
depends_on = None


UPGRADE = [
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS repository_path TEXT",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS framework TEXT",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS base_url TEXT",
    "ALTER TABLE projects ADD COLUMN IF NOT EXISTS scan_config JSONB",
    """
    CREATE TABLE IF NOT EXISTS scan_runs (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        progress JSONB NOT NULL DEFAULT '{}'::jsonb,
        config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_summary TEXT,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS scan_runs_project_idx ON scan_runs (project_id, created_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS assets (
        id UUID PRIMARY KEY,
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        file_size_bytes BIGINT,
        content_hash TEXT,
        UNIQUE (project_id, file_path)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS asset_usages (
        id UUID PRIMARY KEY,
        scan_id UUID NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
        asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
        source_file TEXT,
        route TEXT,
        usage_type TEXT NOT NULL,
        confidence TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS asset_usages_scan_idx ON asset_usages (scan_id)",
    """
    CREATE TABLE IF NOT EXISTS scan_assets (
        id UUID PRIMARY KEY,
        scan_id UUID NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
        asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
        file_path TEXT NOT NULL,
        classification TEXT,
        explanation TEXT NOT NULL DEFAULT '',
        confidence TEXT NOT NULL,
        duplicate_of TEXT,
        references_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        routes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        transfer_bytes BIGINT,
        duration_ms DOUBLE PRECISION
    )
    """,
    "CREATE INDEX IF NOT EXISTS scan_assets_scan_idx ON scan_assets (scan_id, classification)",
    """
    CREATE TABLE IF NOT EXISTS page_results (
        id UUID PRIMARY KEY,
        scan_id UUID NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
        route TEXT NOT NULL,
        viewport_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        metric_source TEXT NOT NULL,
        lcp_ms DOUBLE PRECISION,
        inp_ms DOUBLE PRECISION,
        cls DOUBLE PRECISION,
        total_transfer_bytes BIGINT,
        duration_ms DOUBLE PRECISION,
        sample_count INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        error_summary TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS page_results_scan_idx ON page_results (scan_id)",
    """
    CREATE TABLE IF NOT EXISTS api_observations (
        id UUID PRIMARY KEY,
        scan_id UUID NOT NULL REFERENCES scan_runs(id) ON DELETE CASCADE,
        route TEXT NOT NULL,
        endpoint_template TEXT NOT NULL,
        method TEXT NOT NULL,
        status_code INTEGER,
        duration_ms DOUBLE PRECISION,
        transfer_bytes BIGINT,
        failure_type TEXT,
        resource_type TEXT,
        observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS api_observations_scan_idx ON api_observations (scan_id, endpoint_template)",
]


def upgrade() -> None:
    for statement in UPGRADE:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS api_observations")
    op.execute("DROP TABLE IF EXISTS page_results")
    op.execute("DROP TABLE IF EXISTS scan_assets")
    op.execute("DROP TABLE IF EXISTS asset_usages")
    op.execute("DROP TABLE IF EXISTS assets")
    op.execute("DROP TABLE IF EXISTS scan_runs")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS scan_config")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS base_url")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS framework")
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS repository_path")
