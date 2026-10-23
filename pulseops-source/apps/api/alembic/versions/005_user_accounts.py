"""User accounts: role, active flag, last login and update time.

Every statement is idempotent. The demo user becomes the first admin.

Revision ID: 005_user_accounts
Revises: 004_web_vitals
Create Date: 2026-10-21

"""

from alembic import op

revision = "005_user_accounts"
down_revision = "004_web_vitals"
branch_labels = None
depends_on = None

STATEMENTS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'member'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_lower ON users (lower(email))",
    "CREATE INDEX IF NOT EXISTS ix_users_role ON users (role)",
    "UPDATE users SET role = 'admin' WHERE email = 'demo@pulseops.dev'",
]


def upgrade() -> None:
    for statement in STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_role")
    op.execute("DROP INDEX IF EXISTS ix_users_email_lower")
    for column in ("updated_at", "last_login_at", "is_active", "role"):
        op.execute(f"ALTER TABLE users DROP COLUMN IF EXISTS {column}")
