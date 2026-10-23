"""Bid idempotency keys, EXTENSION_CAPPED / AUCTION_* activity types, RFQ closed marker for the auto-close job.

Revision ID: 0002_idempotency_capped_close
Revises: 0001_initial
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_idempotency_capped_close"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

OLD_TYPES = "'RFQ_CREATED','BID_PLACED','EXTENDED'"
NEW_TYPES = OLD_TYPES + ",'EXTENSION_CAPPED','AUCTION_CLOSED','AUCTION_FORCE_CLOSED'"


def upgrade() -> None:
    op.add_column("Bid", sa.Column("idempotencyKey", sa.Text, nullable=True))
    op.add_column("Bid", sa.Column("idempotencyHash", sa.Text, nullable=True))
    op.add_column("Bid", sa.Column("idempotencyResponse", sa.Text, nullable=True))
    # NULL keys don't conflict in Postgres unique constraints, so bids without a key are unaffected.
    op.create_unique_constraint("Bid_rfqId_idempotencyKey_key", "Bid", ["rfqId", "idempotencyKey"])

    op.add_column("Rfq", sa.Column("closedStatus", sa.Text, nullable=True))
    op.add_column("Rfq", sa.Column("closedAt", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint("rfq_closed_status", "Rfq", "\"closedStatus\" IS NULL OR \"closedStatus\" IN ('CLOSED','FORCE_CLOSED')")

    op.drop_constraint("activity_type", "ActivityLog", type_="check")
    op.create_check_constraint("activity_type", "ActivityLog", f"type IN ({NEW_TYPES})")


def downgrade() -> None:
    op.execute("""DELETE FROM "ActivityLog" WHERE type IN ('EXTENSION_CAPPED','AUCTION_CLOSED','AUCTION_FORCE_CLOSED')""")
    op.drop_constraint("activity_type", "ActivityLog", type_="check")
    op.create_check_constraint("activity_type", "ActivityLog", f"type IN ({OLD_TYPES})")
    op.drop_constraint("rfq_closed_status", "Rfq", type_="check")
    op.drop_column("Rfq", "closedAt")
    op.drop_column("Rfq", "closedStatus")
    op.drop_constraint("Bid_rfqId_idempotencyKey_key", "Bid", type_="unique")
    for c in ("idempotencyResponse", "idempotencyHash", "idempotencyKey"):
        op.drop_column("Bid", c)
