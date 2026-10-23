from typing import Any


class HttpError(Exception):
    def __init__(self, status: int, message: str, details: Any = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.details = details


def issues_from_pydantic(errors: list[dict]) -> list[dict]:
    """Pydantic errors -> zod-like issues {code, path, message} (the frontend renders path + message)."""
    out = []
    for e in errors:
        loc = list(e.get("loc", ()))
        if loc and loc[0] == "body":
            loc = loc[1:]
        if e.get("type") == "total_price":
            loc = ["freightCharges"]
        msg = e.get("msg", "Invalid value")
        if e.get("type") == "missing":
            msg = "Required"
        out.append({"code": e.get("type"), "path": loc, "message": msg})
    return out
