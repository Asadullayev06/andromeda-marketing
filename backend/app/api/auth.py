"""Login / logout / current-user endpoints (shared ANDROMEDA accounts)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from fastapi import Depends

from ..auth import (
    InvalidCredentials,
    Role,
    create_session_token,
    record_login_event,
    revoke_session,
    verify_credentials,
)
from ..db import get_db
from ..config import settings
from ..models import User

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> Optional[str]:
    forwarded = request.headers.get("cf-connecting-ip") or request.headers.get(
        "x-forwarded-for", ""
    ).split(",", 1)[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else None


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    role: Role
    username: str
    display_name: Optional[str] = None
    expires_at: int
    can_edit_stock: bool


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> LoginResponse:
    username = payload.username.strip().lower()
    ip = _client_ip(request)
    user_agent = request.headers.get("user-agent")
    try:
        role, user_id = verify_credentials(payload.username, payload.password)
    except InvalidCredentials:
        record_login_event(
            username=username, success=False, role=None, ip=ip,
            user_agent=user_agent, failure_reason="invalid_credentials",
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password.")
    token, exp = create_session_token(
        username=username, role=role, user_id=user_id, ip=ip, user_agent=user_agent,
    )
    record_login_event(username=username, success=True, role=role, ip=ip, user_agent=user_agent)
    user = db.scalar(select(User).where(User.username == username))
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=settings.auth_token_ttl_seconds,
        httponly=True,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
    )
    return LoginResponse(
        role=role,
        username=username,
        display_name=user.display_name if user else None,
        expires_at=exp,
        can_edit_stock=settings.can_edit_stock(role, username),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response) -> None:
    revoke_session(getattr(request.state, "session_id", ""))
    response.delete_cookie(settings.auth_cookie_name, path="/", secure=settings.secure_cookies, samesite="lax")


class MeResponse(BaseModel):
    username: str
    role: Optional[Role] = None
    display_name: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    can_edit_stock: bool = False


@router.get("/me", response_model=MeResponse)
def me(request: Request, db: Session = Depends(get_db)) -> MeResponse:
    username = getattr(request.state, "user_name", None)
    role = getattr(request.state, "user_role", None)
    user = db.scalar(select(User).where(User.username == username)) if username else None
    return MeResponse(
        username=username or "",
        role=role,
        display_name=user.display_name if user else None,
        department=user.department if user else None,
        position=user.position if user else None,
        can_edit_stock=settings.can_edit_stock(role, username),
    )
