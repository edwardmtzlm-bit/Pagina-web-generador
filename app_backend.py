from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, Depends
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_404_NOT_FOUND

from pydantic import BaseModel
from sqlalchemy import create_engine, Column, String, Boolean, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from sqlalchemy.sql import func, select
from passlib.context import CryptContext
from jose import jwt, JWTError

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch

from PyPDF2 import PdfReader, PdfWriter

from typing import Optional, List
import io
import textwrap
import os
import uuid
import copy
from datetime import datetime, timezone, timedelta
from pathlib import Path

app = FastAPI(
    title="HM PDF Backend",
    description=(
        "Backend simple para generar y proteger PDFs.\n"
        "- /generar-pdf: genera un PDF a partir de título y cuerpo.\n"
        "- /proteger-pdf: recibe un PDF y devuelve versión protegida."
    ),
)

# CORS básico por si lo llamas desde tu web
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # luego lo puedes restringir a tu dominio
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_TOKEN = os.getenv("API_TOKEN", "").strip()
TEMPLATES_DIR = Path(os.getenv("TEMPLATES_DIR", "templates"))
MAX_TEMPLATE_MB = float(os.getenv("MAX_TEMPLATE_MB", "15"))
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
JWT_SECRET = os.getenv("JWT_SECRET", "").strip()
JWT_ALG = os.getenv("JWT_ALG", "HS256").strip()
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "").strip()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "").strip()
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "").strip()

TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
Base = declarative_base()
engine = None
SessionLocal = None

if DATABASE_URL:
    db_url = DATABASE_URL.replace("postgres://", "postgresql+psycopg://", 1)
    engine = create_engine(db_url, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String, unique=True, nullable=False, index=True)
    email = Column(String, unique=True, nullable=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="admin")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "vendedor"
    email: Optional[str] = None


class UserOut(BaseModel):
    id: str
    username: str
    email: Optional[str]
    role: str
    is_active: bool


def user_to_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
    )


def get_db() -> Session:
    if not SessionLocal:
        raise HTTPException(status_code=500, detail="Database not configured")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(subject: str) -> str:
    if not JWT_SECRET:
        raise HTTPException(status_code=500, detail="JWT_SECRET not configured")
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def get_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Auth requerida")
    if not JWT_SECRET:
        raise HTTPException(status_code=500, detail="JWT_SECRET not configured")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError:
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Token invalido")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Token invalido")
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Usuario inactivo")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Permiso denegado")
    return user


def ensure_admin_user() -> None:
    if not engine or not ADMIN_USERNAME or not ADMIN_PASSWORD:
        return
    db = SessionLocal()
    try:
        existing = db.execute(select(User).where(User.username == ADMIN_USERNAME)).scalar_one_or_none()
        if existing:
            return
        user = User(
            username=ADMIN_USERNAME,
            email=ADMIN_EMAIL or None,
            password_hash=hash_password(ADMIN_PASSWORD),
            role="admin",
            is_active=True,
        )
        db.add(user)
        db.commit()
    finally:
        db.close()


@app.on_event("startup")
def on_startup() -> None:
    if engine:
        Base.metadata.create_all(bind=engine)
        ensure_admin_user()


def auth_guard(authorization: Optional[str]) -> None:
    """
    Validación simple de Bearer token para proteger endpoints.
    """
    if not API_TOKEN:
        return  # sin token configurado, no se aplica auth
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Auth requerida")
    token = authorization.split(" ", 1)[1].strip()
    if token != API_TOKEN:
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Token inválido")


# =========================
#        AUTH API
# =========================
@app.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.username == payload.username)).scalar_one_or_none()
    if not user and "@" in payload.username:
        user = db.execute(select(User).where(User.email == payload.username)).scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Credenciales invalidas")
    if not user.is_active:
        raise HTTPException(status_code=HTTP_401_UNAUTHORIZED, detail="Usuario inactivo")
    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


@app.get("/auth/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return user_to_out(current_user)


@app.post("/users", response_model=UserOut)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    role = payload.role.strip().lower()
    if role not in {"admin", "vendedor"}:
        raise HTTPException(status_code=400, detail="Rol invalido")
    existing = db.execute(select(User).where(User.username == payload.username)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Usuario ya existe")
    if payload.email:
        email_exists = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
        if email_exists:
            raise HTTPException(status_code=400, detail="Email ya existe")
    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user_to_out(user)


def sanitize_name(name: str) -> str:
    base = (name or "plantilla").strip()
    base = base.replace("/", "_").replace("\\", "_")
    base = base.replace(" ", "_")
    allowed = []
    for ch in base:
        if ch.isalnum() or ch in ("_", "-", "."):
            allowed.append(ch)
    safe = "".join(allowed)
    return safe[:80] or "plantilla"


def list_template_files() -> List[dict]:
    items = []
    for file in TEMPLATES_DIR.glob("*.pdf"):
        parts = file.name.split("__", 1)
        if len(parts) != 2:
            continue
        tpl_id = parts[0]
        name_part = parts[1].rsplit(".pdf", 1)[0]
        stats = file.stat()
        items.append(
            {
                "id": tpl_id,
                "name": name_part,
                "size": stats.st_size,
                "createdAt": datetime.fromtimestamp(stats.st_mtime, tz=timezone.utc).isoformat(),
                "filename": file.name,
            }
        )
    # recientes primero
    items.sort(key=lambda x: x["createdAt"], reverse=True)
    return items


def find_template_path(tpl_id: str) -> Optional[Path]:
    for file in TEMPLATES_DIR.glob(f"{tpl_id}__*.pdf"):
        return file
    return None


# =========================
#   UTILIDAD: CREAR PDF
# =========================
def crear_pdf_en_memoria(titulo: str, cuerpo: str) -> bytes:
    """
    Genera un PDF simple (tamaño carta, márgenes decentes, respeta saltos de línea).
    Devuelve los bytes del PDF.
    """
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter

    # Márgenes
    margen_x = 1 * inch
    margen_superior = height - 1 * inch
    margen_inferior = 1 * inch

    # Config fuentes
    font_title = ("Helvetica-Bold", 16)
    font_body = ("Helvetica", 11)
    leading = 14  # interlineado

    # ===== Página inicial =====
    c.setTitle(titulo or "Documento")

    # TÍTULO
    y = margen_superior
    if titulo:
        c.setFont(*font_title)
        wrapper_title = textwrap.TextWrapper(width=80, break_long_words=False)
        for line in wrapper_title.wrap(titulo):
            c.drawString(margen_x, y, line)
            y -= leading + 2
        y -= 10  # espacio extra después del título

    # CUERPO
    c.setFont(*font_body)
    wrapper = textwrap.TextWrapper(width=95, break_long_words=False)

    def nueva_pagina():
        nonlocal y
        c.showPage()
        y = height - 1 * inch
        c.setFont(*font_body)

    for raw_parrafo in cuerpo.split("\n"):
        parrafo = raw_parrafo.rstrip()

        # Línea en blanco -> salto de párrafo
        if parrafo.strip() == "":
            y -= leading
            if y < margen_inferior:
                nueva_pagina()
            continue

        # Romper en líneas
        for line in wrapper.wrap(parrafo):
            if y < margen_inferior:
                nueva_pagina()
            c.drawString(margen_x, y, line)
            y -= leading

    c.showPage()
    c.save()
    buffer.seek(0)
    return buffer.read()


def mezclar_con_plantilla(contenido: bytes, plantilla: bytes) -> bytes:
    """
    Superpone cada página del contenido sobre la plantilla (repite última página de la plantilla si faltan).
    """
    content_reader = PdfReader(io.BytesIO(contenido))
    tpl_reader = PdfReader(io.BytesIO(plantilla))

    writer = PdfWriter()
    n_tpl = len(tpl_reader.pages)
    if n_tpl == 0:
        return contenido

    for i, page in enumerate(content_reader.pages):
        tpl_idx = i if i < n_tpl else n_tpl - 1
        base = copy.deepcopy(tpl_reader.pages[tpl_idx])
        base.merge_page(page)
        writer.add_page(base)

    out_buf = io.BytesIO()
    writer.write(out_buf)
    out_buf.seek(0)
    return out_buf.read()


# =========================
#       ENDPOINTS
# =========================
@app.get("/ping")
def ping():
    return {"ok": True}


@app.post("/generar-pdf")
async def generar_pdf(
    titulo: str = Form(..., description="Título del documento"),
    cuerpo: str = Form(..., description="Cuerpo del documento"),
    proteger: bool = Form(False, description="Si es True, bloquea impresión y copia"),
    plantilla: Optional[UploadFile] = File(
        None,
        description="Plantilla PDF (por ahora se recibe pero NO se mezcla aún)",
    ),
):
    """
    - Crea un PDF desde título/cuerpo.
    - (Por ahora) ignora la plantilla.
    - Si 'proteger' es True, aplica restricciones.
    """
    try:
        # 1) Generar PDF base
        pdf_bytes = crear_pdf_en_memoria(titulo, cuerpo)

        # 2) Plantilla por ahora ignorada (para que no marque sin usar)
        _ = plantilla

        # 3) Aplicar protección (opcional)
        if proteger:
            reader = PdfReader(io.BytesIO(pdf_bytes))
            writer = PdfWriter()
            for page in reader.pages:
                writer.add_page(page)

            # 0b0000 -> todos los permisos desactivados (incluye imprimir/copiar)
            permissions_flag = 0b0000

            writer.encrypt(
                "",
                "HM2025!",       # contraseña de propietario
                permissions_flag=permissions_flag,
            )

            out_buf = io.BytesIO()
            writer.write(out_buf)
            out_buf.seek(0)
            pdf_bytes = out_buf.read()

        # 4) Respuesta como archivo descargable
        filename = (titulo or "documento").strip() or "documento"
        filename = filename.replace("/", "_").replace("\\", "_")[:60] + ".pdf"

        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            },
        )

    except Exception as e:
        msg = f"Internal Server Error: {type(e).__name__}: {e}"
        return StreamingResponse(
            io.BytesIO(msg.encode("utf-8")),
            media_type="text/plain",
            status_code=500,
        )


@app.post("/proteger-pdf")
async def proteger_pdf(
    archivo: UploadFile = File(..., description="PDF ya generado que quieres proteger"),
):
    """
    - Recibe un PDF (por ejemplo, el que generas en React con tu plantilla).
    - Le aplica cifrado y bloquea impresión/copia.
    - Devuelve el PDF protegido.
    """
    try:
        data = await archivo.read()

        reader = PdfReader(io.BytesIO(data))
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)

        # Sin permisos: no imprimir, no copiar, etc.
        permissions_flag = 0b0000

        writer.encrypt(
            "",
            "HM2025!",           # contraseña de propietario
            permissions_flag=permissions_flag,
        )

        out_buf = io.BytesIO()
        writer.write(out_buf)
        out_buf.seek(0)

        filename = archivo.filename or "documento_protegido.pdf"
        if not filename.lower().endswith(".pdf"):
            filename += ".pdf"

        return StreamingResponse(
            out_buf,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            },
        )

    except Exception as e:
        msg = f"Internal Server Error: {type(e).__name__}: {e}"
        return StreamingResponse(
            io.BytesIO(msg.encode("utf-8")),
            media_type="text/plain",
            status_code=500,
        )


# =========================
#    API PLANTILLAS
# =========================

@app.get("/api/templates")
async def listar_plantillas(authorization: Optional[str] = Header(None)):
    auth_guard(authorization)
    return list_template_files()


@app.post("/api/templates")
async def subir_plantilla(
    archivo: UploadFile = File(..., description="PDF de plantilla"),
    nombre: Optional[str] = Form(None, description="Nombre legible"),
    authorization: Optional[str] = Header(None),
):
    auth_guard(authorization)

    data = await archivo.read()
    size_mb = len(data) / (1024 * 1024)
    if size_mb > MAX_TEMPLATE_MB:
        raise HTTPException(status_code=413, detail=f"Límite {MAX_TEMPLATE_MB} MB")

    safe_name = sanitize_name(nombre or Path(archivo.filename or "plantilla").stem)
    tpl_id = str(uuid.uuid4())
    filename = f"{tpl_id}__{safe_name}.pdf"
    dest = TEMPLATES_DIR / filename

    with open(dest, "wb") as f:
        f.write(data)

    stats = dest.stat()
    return {
        "id": tpl_id,
        "name": safe_name,
        "size": stats.st_size,
        "createdAt": datetime.fromtimestamp(stats.st_mtime, tz=timezone.utc).isoformat(),
        "filename": filename,
    }


@app.delete("/api/templates/{tpl_id}")
async def borrar_plantilla(tpl_id: str, authorization: Optional[str] = Header(None)):
    auth_guard(authorization)
    path = find_template_path(tpl_id)
    if not path or not path.exists():
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="No encontrada")
    path.unlink()
    return {"ok": True}


@app.get("/api/templates/{tpl_id}/download")
async def descargar_plantilla(tpl_id: str, authorization: Optional[str] = Header(None)):
    auth_guard(authorization)
    path = find_template_path(tpl_id)
    if not path or not path.exists():
        raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="No encontrada")

    return StreamingResponse(
        open(path, "rb"),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{path.name}"'},
    )


@app.post("/api/generate")
async def generar_desde_api(
    titulo: str = Form(...),
    cuerpo: str = Form(...),
    templateId: Optional[str] = Form(None),
    proteger: bool = Form(False),
    authorization: Optional[str] = Header(None),
):
    """
    Genera un PDF con título/cuerpo y opcionalmente mezcla una plantilla guardada.
    """
    auth_guard(authorization)

    try:
        pdf_bytes = crear_pdf_en_memoria(titulo, cuerpo)

        if templateId:
            path = find_template_path(templateId)
            if not path or not path.exists():
                raise HTTPException(status_code=HTTP_404_NOT_FOUND, detail="Plantilla no encontrada")
            with open(path, "rb") as f:
                tpl_bytes = f.read()
            pdf_bytes = mezclar_con_plantilla(pdf_bytes, tpl_bytes)

        # Protección opcional
        if proteger:
            reader = PdfReader(io.BytesIO(pdf_bytes))
            writer = PdfWriter()
            for page in reader.pages:
                writer.add_page(page)
            permissions_flag = 0b0000
            writer.encrypt("", "HM2025!", permissions_flag=permissions_flag)
            out_buf = io.BytesIO()
            writer.write(out_buf)
            out_buf.seek(0)
            pdf_bytes = out_buf.read()

        filename = (titulo or "documento").strip() or "documento"
        filename = filename.replace("/", "_").replace("\\", "_")[:60] + ".pdf"

        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        msg = f"Internal Server Error: {type(e).__name__}: {e}"
        return StreamingResponse(
            io.BytesIO(msg.encode("utf-8")),
            media_type="text/plain",
            status_code=500,
        )
