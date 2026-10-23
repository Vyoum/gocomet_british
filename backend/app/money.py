"""Money is stored as integer minor units (paise/cents); the API speaks decimal amounts."""


def to_minor(amount: float) -> int:
    return round(amount * 100)


def from_minor(minor: int) -> int | float:
    # whole amounts serialize as 2350 (like JS), others as 2350.5
    return minor // 100 if minor % 100 == 0 else minor / 100


def fmt_money(minor: int) -> str:
    return f"{minor / 100:.2f}"
