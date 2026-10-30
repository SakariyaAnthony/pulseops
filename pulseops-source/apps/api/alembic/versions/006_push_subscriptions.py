"""Browser Web Push subscriptions, one row per browser per user.

Every statement is idempotent.

Revision ID: 006_push_subscriptions
Revises: 005_user_accounts
Create Date: 2026-10-28

"""

from alembic import op

revision = "006_push_subscriptions"
down_revision = "005_user_accounts"
branch_labels = None
depends_on = None

STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS push_subscriptions (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        severities JSONB NOT NULL DEFAULT '["critical", "warning", "info"]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_push_subscriptions_user_id ON push_subscriptions (user_id)",
]


def upgrade() -> None:
    for statement in STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS push_subscriptions")
