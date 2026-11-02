"""Field web vitals, page loads, and Lighthouse lab columns.

Every statement is idempotent. Some databases already carry a few of these page_results columns, so
ADD COLUMN IF NOT EXISTS keeps the migration safe on both.

Revision ID: 004_web_vitals
Revises: 003_asset_signals
Create Date: 2026-10-21

"""

from alembic import op

revision = "004_web_vitals"
down_revision = "003_asset_signals"
branch_labels = None
depends_on = None

TABLES = [
    """
    CREATE TABLE IF NOT EXISTS web_vitals (
        time TIMESTAMPTZ NOT NULL,
        project_id UUID NOT NULL,
        env TEXT NOT NULL,
        service TEXT NOT NULL,
        route TEXT NOT NULL,
        nav_type TEXT NOT NULL,
        device TEXT NOT NULL,
        metric TEXT NOT NULL,
        value DOUBLE PRECISION NOT NULL,
        rating TEXT,
        page_view_id TEXT,
        connection TEXT,
        version TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS page_loads (
        time TIMESTAMPTZ NOT NULL,
        project_id UUID NOT NULL,
        env TEXT NOT NULL,
        service TEXT NOT NULL,
        route TEXT NOT NULL,
        nav_type TEXT NOT NULL,
        device TEXT NOT NULL,
        ttfb_ms DOUBLE PRECISION,
        dom_content_loaded_ms DOUBLE PRECISION,
        load_ms DOUBLE PRECISION,
        transfer_bytes BIGINT,
        resource_count INTEGER,
        js_bytes BIGINT,
        long_task_count INTEGER,
        long_task_ms DOUBLE PRECISION,
        tbt_ms DOUBLE PRECISION,
        page_view_id TEXT,
        version TEXT
    )
    """,
]

PAGE_RESULT_COLUMNS = [
    ("form_factor", "TEXT"),
    ("ttfb_ms", "DOUBLE PRECISION"),
    ("fcp_ms", "DOUBLE PRECISION"),
    ("tbt_ms", "DOUBLE PRECISION"),
    ("speed_index", "DOUBLE PRECISION"),
    ("perf_score", "INTEGER"),
    ("script_ms", "DOUBLE PRECISION"),
    ("long_task_count", "INTEGER"),
    ("long_task_total_ms", "DOUBLE PRECISION"),
    ("resource_count", "INTEGER"),
    ("resource_summary_json", "JSONB NOT NULL DEFAULT '{}'::jsonb"),
    ("diagnosis_json", "JSONB NOT NULL DEFAULT '[]'::jsonb"),
]


def upgrade() -> None:
    for statement in TABLES:
        op.execute(statement)
    for name, kind in PAGE_RESULT_COLUMNS:
        op.execute(f"ALTER TABLE page_results ADD COLUMN IF NOT EXISTS {name} {kind}")
    with op.get_context().autocommit_block():
        op.execute("SELECT create_hypertable('web_vitals', 'time', if_not_exists => TRUE)")
        op.execute("SELECT create_hypertable('page_loads', 'time', if_not_exists => TRUE)")
        op.execute(
            "CREATE INDEX IF NOT EXISTS web_vitals_lookup_idx ON web_vitals (project_id, route, metric, time DESC)"
        )
        op.execute("CREATE INDEX IF NOT EXISTS page_loads_lookup_idx ON page_loads (project_id, route, time DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS page_loads")
    op.execute("DROP TABLE IF EXISTS web_vitals")
    for name, _kind in PAGE_RESULT_COLUMNS:
        # Columns that other databases created earlier are left alone.
        if name in {"form_factor", "tbt_ms", "speed_index", "perf_score", "script_ms", "resource_count", "resource_summary_json", "diagnosis_json"}:
            op.execute(f"ALTER TABLE page_results DROP COLUMN IF EXISTS {name}")
