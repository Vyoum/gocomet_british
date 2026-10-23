"""Strict request parsing (same rules as the former zod schemas). Money -> integer minor units."""
import math
import re
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, model_validator
from pydantic_core import PydanticCustomError

from .money import to_minor

_NUM = re.compile(r"^-?\d+(\.\d+)?$")


def strict_number(v: Any) -> int | float:
    """JSON number or non-empty numeric string. Rejects "", null, blanks, booleans, text, NaN/inf."""
    if isinstance(v, bool):
        raise PydanticCustomError("invalid_type", "Expected a number")
    if isinstance(v, (int, float)):
        if isinstance(v, float) and not math.isfinite(v):
            raise PydanticCustomError("invalid_type", "Expected a finite number")
        return v
    if isinstance(v, str) and _NUM.match(v.strip()):
        s = v.strip()
        return float(s) if "." in s else int(s)
    raise PydanticCustomError("invalid_type", "Expected a number")


def strict_date(v: Any) -> datetime:
    """Non-empty ISO string or epoch milliseconds. Naive datetimes are treated as UTC."""
    if isinstance(v, bool) or v is None:
        raise PydanticCustomError("invalid_type", "Expected a date")
    if isinstance(v, (int, float)):
        try:
            return datetime.fromtimestamp(v / 1000, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            raise PydanticCustomError("invalid_date", "Invalid date")
    if isinstance(v, str):
        s = v.strip()
        if not s:
            raise PydanticCustomError("too_small", "Expected a date")
        try:
            d = datetime.fromisoformat(s)
        except ValueError:
            raise PydanticCustomError("invalid_date", "Invalid date")
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    raise PydanticCustomError("invalid_type", "Expected a date")


def pos_int(v: Any) -> int:
    n = strict_number(v)
    if isinstance(n, float):
        if not n.is_integer():
            raise PydanticCustomError("invalid_type", "Expected integer, received float")
        n = int(n)
    if n <= 0:
        raise PydanticCustomError("too_small", "Number must be greater than 0")
    return n


def money(v: Any) -> int:
    n = strict_number(v)
    if n < 0:
        raise PydanticCustomError("too_small", "Number must be greater than or equal to 0")
    if abs(to_minor(n) - n * 100) >= 1e-6:
        raise PydanticCustomError("custom", "At most 2 decimal places")
    return to_minor(n)


def non_empty_str(v: Any) -> str:
    if not isinstance(v, str):
        raise PydanticCustomError("invalid_type", "Expected string")
    s = v.strip()
    if not s:
        raise PydanticCustomError("too_small", "String must contain at least 1 character(s)")
    return s


def plain_non_empty_str(v: Any) -> str:
    if not isinstance(v, str):
        raise PydanticCustomError("invalid_type", "Expected string")
    if not v:
        raise PydanticCustomError("too_small", "String must contain at least 1 character(s)")
    return v


def trigger_type(v: Any) -> str:
    if v not in ("BID_RECEIVED", "ANY_RANK_CHANGE", "L1_CHANGE"):
        raise PydanticCustomError(
            "invalid_enum_value", "Invalid enum value. Expected 'BID_RECEIVED' | 'ANY_RANK_CHANGE' | 'L1_CHANGE'"
        )
    return v


StrictDate = Annotated[datetime, BeforeValidator(strict_date)]
PosInt = Annotated[int, BeforeValidator(pos_int)]
Money = Annotated[int, BeforeValidator(money)]
TrimmedStr = Annotated[str, BeforeValidator(non_empty_str)]


class RfqIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    referenceId: TrimmedStr
    name: TrimmedStr
    bidStartTime: StrictDate
    bidCloseTime: StrictDate
    forcedCloseTime: StrictDate
    pickupDate: StrictDate
    triggerWindowMinutes: PosInt
    extensionMinutes: PosInt
    triggerType: Annotated[Literal["BID_RECEIVED", "ANY_RANK_CHANGE", "L1_CHANGE"], BeforeValidator(trigger_type)]


class BidIn(BaseModel):
    """Charges arrive as decimals and are held here as integer minor units."""

    model_config = ConfigDict(extra="ignore")
    supplierId: Annotated[str, BeforeValidator(plain_non_empty_str)]
    freightCharges: Money
    originCharges: Money
    destinationCharges: Money
    transitTimeDays: PosInt
    quoteValidUntil: StrictDate

    @model_validator(mode="after")
    def _total_positive(self) -> "BidIn":
        if self.freightCharges + self.originCharges + self.destinationCharges <= 0:
            # path is remapped to ["freightCharges"] by the error handler (matches the old API)
            raise PydanticCustomError("total_price", "Total price must be greater than 0")
        return self
