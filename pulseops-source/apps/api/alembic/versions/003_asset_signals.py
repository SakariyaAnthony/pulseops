"""Image and load signals on scan assets.

Revision ID: 003_asset_signals
Revises: 002_scans
Create Date: 2026-10-19

"""

from alembic import op

revision = "003_asset_signals"
down_revision = "002_scans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE scan_assets ADD COLUMN IF NOT EXISTS failure_type TEXT")
    op.execute("ALTER TABLE scan_assets ADD COLUMN IF NOT EXISTS signals_json JSONB NOT NULL DEFAULT '{}'::jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE scan_assets DROP COLUMN IF EXISTS signals_json")
    op.execute("ALTER TABLE scan_assets DROP COLUMN IF EXISTS failure_type")
