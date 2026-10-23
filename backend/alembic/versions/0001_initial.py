"""Initial schema (replaces the former Prisma schema).

Drops any tables left by the old Node/Prisma backend (Supplier, Rfq, Bid, ActivityLog, _prisma_migrations)
and recreates them fresh with CHECK constraints. Existing data in those tables is discarded; on Render the
demo seed (SEED_DEMO=true) repopulates the now-empty database. Runs once per DB (tracked in alembic_version).

Revision ID: 0001_initial
Revises:
"""
import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    for t in ("ActivityLog", "Bid", "Rfq", "Supplier", "_prisma_migrations"):
        op.execute(f'DROP TABLE IF EXISTS "{t}" CASCADE')

    op.create_table(
        "Supplier",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("createdAt", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("name", name="Supplier_name_key"),
    )
    op.create_table(
        "Rfq",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("referenceId", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("bidStartTime", TS, nullable=False),
        sa.Column("bidCloseTime", TS, nullable=False),
        sa.Column("currentCloseTime", TS, nullable=False),
        sa.Column("forcedCloseTime", TS, nullable=False),
        sa.Column("pickupDate", TS, nullable=False),
        sa.Column("triggerWindowMinutes", sa.Integer, nullable=False),
        sa.Column("extensionMinutes", sa.Integer, nullable=False),
        sa.Column("triggerType", sa.String, nullable=False),
        sa.Column("extensionCount", sa.Integer, nullable=False, server_default="0"),
        sa.Column("createdAt", TS, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("referenceId", name="Rfq_referenceId_key"),
        sa.CheckConstraint('"bidCloseTime" > "bidStartTime"', name="rfq_close_after_start"),
        sa.CheckConstraint('"forcedCloseTime" > "bidCloseTime"', name="rfq_forced_after_close"),
        sa.CheckConstraint('"currentCloseTime" <= "forcedCloseTime"', name="rfq_current_le_forced"),
        sa.CheckConstraint('"currentCloseTime" >= "bidCloseTime"', name="rfq_current_ge_close"),
        sa.CheckConstraint('"triggerWindowMinutes" > 0 AND "extensionMinutes" > 0', name="rfq_positive_xy"),
        sa.CheckConstraint("\"triggerType\" IN ('BID_RECEIVED','ANY_RANK_CHANGE','L1_CHANGE')", name="rfq_trigger_type"),
    )
    op.create_index("Rfq_currentCloseTime_idx", "Rfq", ["currentCloseTime"])
    op.create_table(
        "Bid",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("rfqId", sa.Text, sa.ForeignKey("Rfq.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False),
        sa.Column("supplierId", sa.Text, sa.ForeignKey("Supplier.id", ondelete="RESTRICT", onupdate="CASCADE"), nullable=False),
        sa.Column("freightCharges", sa.Integer, nullable=False),
        sa.Column("originCharges", sa.Integer, nullable=False),
        sa.Column("destinationCharges", sa.Integer, nullable=False),
        sa.Column("totalPrice", sa.Integer, nullable=False),
        sa.Column("transitTimeDays", sa.Integer, nullable=False),
        sa.Column("quoteValidUntil", TS, nullable=False),
        sa.Column("createdAt", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint('"freightCharges" >= 0 AND "originCharges" >= 0 AND "destinationCharges" >= 0', name="bid_charges_nonneg"),
        sa.CheckConstraint('"totalPrice" > 0', name="bid_total_positive"),
        sa.CheckConstraint('"transitTimeDays" > 0', name="bid_transit_positive"),
    )
    op.create_index("Bid_rfqId_supplierId_createdAt_idx", "Bid", ["rfqId", "supplierId", "createdAt"])
    op.create_table(
        "ActivityLog",
        sa.Column("id", sa.Text, primary_key=True),
        sa.Column("rfqId", sa.Text, sa.ForeignKey("Rfq.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False),
        sa.Column("type", sa.Text, nullable=False),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("metadata", sa.Text, nullable=True),
        sa.Column("createdAt", TS, nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("type IN ('RFQ_CREATED','BID_PLACED','EXTENDED')", name="activity_type"),
    )
    op.create_index("ActivityLog_rfqId_createdAt_idx", "ActivityLog", ["rfqId", "createdAt"])


def downgrade() -> None:
    for t in ("ActivityLog", "Bid", "Rfq", "Supplier"):
        op.drop_table(t)
