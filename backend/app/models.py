"""Same tables/columns as the former Prisma schema (quoted camelCase names), plus CHECK constraints."""
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _uuid() -> str:
    return str(uuid.uuid4())


TS = DateTime(timezone=True)


class Base(DeclarativeBase):
    pass


class Supplier(Base):
    __tablename__ = "Supplier"
    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = mapped_column("createdAt", TS, server_default=func.now())


class Rfq(Base):
    __tablename__ = "Rfq"
    __table_args__ = (
        CheckConstraint('"bidCloseTime" > "bidStartTime"', name="rfq_close_after_start"),
        CheckConstraint('"forcedCloseTime" > "bidCloseTime"', name="rfq_forced_after_close"),
        CheckConstraint('"currentCloseTime" <= "forcedCloseTime"', name="rfq_current_le_forced"),
        CheckConstraint('"currentCloseTime" >= "bidCloseTime"', name="rfq_current_ge_close"),
        CheckConstraint('"triggerWindowMinutes" > 0 AND "extensionMinutes" > 0', name="rfq_positive_xy"),
        CheckConstraint("\"triggerType\" IN ('BID_RECEIVED','ANY_RANK_CHANGE','L1_CHANGE')", name="rfq_trigger_type"),
        Index("Rfq_currentCloseTime_idx", "currentCloseTime"),
    )
    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    reference_id: Mapped[str] = mapped_column("referenceId", Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    bid_start_time: Mapped[datetime] = mapped_column("bidStartTime", TS)
    bid_close_time: Mapped[datetime] = mapped_column("bidCloseTime", TS)
    current_close_time: Mapped[datetime] = mapped_column("currentCloseTime", TS)
    forced_close_time: Mapped[datetime] = mapped_column("forcedCloseTime", TS)
    pickup_date: Mapped[datetime] = mapped_column("pickupDate", TS)
    trigger_window_minutes: Mapped[int] = mapped_column("triggerWindowMinutes", Integer)
    extension_minutes: Mapped[int] = mapped_column("extensionMinutes", Integer)
    trigger_type: Mapped[str] = mapped_column("triggerType", String)
    extension_count: Mapped[int] = mapped_column("extensionCount", Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column("createdAt", TS, server_default=func.now())

    bids: Mapped[list["Bid"]] = relationship(back_populates="rfq", passive_deletes=True)
    activity: Mapped[list["ActivityLog"]] = relationship(passive_deletes=True)


class Bid(Base):
    __tablename__ = "Bid"
    __table_args__ = (
        CheckConstraint('"freightCharges" >= 0 AND "originCharges" >= 0 AND "destinationCharges" >= 0', name="bid_charges_nonneg"),
        CheckConstraint('"totalPrice" > 0', name="bid_total_positive"),
        CheckConstraint('"transitTimeDays" > 0', name="bid_transit_positive"),
        Index("Bid_rfqId_supplierId_createdAt_idx", "rfqId", "supplierId", "createdAt"),
    )
    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    rfq_id: Mapped[str] = mapped_column("rfqId", Text, ForeignKey("Rfq.id", ondelete="CASCADE", onupdate="CASCADE"))
    supplier_id: Mapped[str] = mapped_column("supplierId", Text, ForeignKey("Supplier.id", ondelete="RESTRICT", onupdate="CASCADE"))
    freight_charges: Mapped[int] = mapped_column("freightCharges", Integer)
    origin_charges: Mapped[int] = mapped_column("originCharges", Integer)
    destination_charges: Mapped[int] = mapped_column("destinationCharges", Integer)
    total_price: Mapped[int] = mapped_column("totalPrice", Integer)
    transit_time_days: Mapped[int] = mapped_column("transitTimeDays", Integer)
    quote_valid_until: Mapped[datetime] = mapped_column("quoteValidUntil", TS)
    created_at: Mapped[datetime] = mapped_column("createdAt", TS, server_default=func.now())

    rfq: Mapped[Rfq] = relationship(back_populates="bids")
    supplier: Mapped[Supplier] = relationship()


class ActivityLog(Base):
    __tablename__ = "ActivityLog"
    __table_args__ = (
        CheckConstraint("type IN ('RFQ_CREATED','BID_PLACED','EXTENDED')", name="activity_type"),
        Index("ActivityLog_rfqId_createdAt_idx", "rfqId", "createdAt"),
    )
    id: Mapped[str] = mapped_column(Text, primary_key=True, default=_uuid)
    rfq_id: Mapped[str] = mapped_column("rfqId", Text, ForeignKey("Rfq.id", ondelete="CASCADE", onupdate="CASCADE"))
    type: Mapped[str] = mapped_column(Text)
    message: Mapped[str] = mapped_column(Text)
    metadata_: Mapped[str | None] = mapped_column("metadata", Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column("createdAt", TS, server_default=func.now())
