"""
Serviço de assinatura PAdES com pyHanko.

Regras de segurança (ver CLAUDE.md §6):
- O .pfx vive em tmpfs, é usado e destruído no finally.
- A senha nunca é logada.
- Nada é persistido entre requisições.
"""
from __future__ import annotations

import io
import logging
import os
import secrets
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse

from pyhanko.sign import signers
from pyhanko.sign.fields import SigSeedSubFilter, SigFieldSpec, append_signature_field
from pyhanko.sign.timestamps import HTTPTimeStamper
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.stamp import TextStampStyle
from pyhanko_certvalidator import ValidationContext

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
log = logging.getLogger("signer")

app = FastAPI(title="DocSign Signer", version="1.0.0")

MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "25"))
MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024
TMPDIR = os.getenv("SIGNER_TMPDIR", "/tmp/signer")
os.makedirs(TMPDIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Erros mapeados para mensagens acionáveis em PT-BR
# ---------------------------------------------------------------------------
class SignError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        self.code = code
        self.message = message
        self.status = status


def _shred(path: str) -> None:
    """Sobrescreve e remove o arquivo de certificado do tmpfs."""
    try:
        if os.path.exists(path):
            size = os.path.getsize(path)
            with open(path, "ba+", buffering=0) as f:
                f.seek(0)
                f.write(secrets.token_bytes(max(size, 1)))
                f.flush()
                os.fsync(f.fileno())
            os.unlink(path)
    except OSError:
        log.warning("falha ao remover material temporario de certificado")


def _validate_magic(data: bytes, expected: bytes, name: str) -> None:
    if not data.startswith(expected):
        raise SignError("INVALID_FILE", f"O arquivo enviado não é um {name} válido.", 415)


async def _read_limited(upload: UploadFile, name: str) -> bytes:
    data = await upload.read()
    if len(data) == 0:
        raise SignError("EMPTY_FILE", f"O arquivo {name} está vazio.", 400)
    if len(data) > MAX_BYTES:
        raise SignError("TOO_LARGE", f"O arquivo {name} excede {MAX_UPLOAD_MB} MB.", 413)
    return data


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/sign")
async def sign(
    pdf: UploadFile = File(...),
    pfx: UploadFile = File(...),
    password: str = Form(...),
    tsa_url: Optional[str] = Form(None),
    level: str = Form("B-T"),
    reason: Optional[str] = Form(None),
    location: Optional[str] = Form(None),
    contact: Optional[str] = Form(None),
    visible: bool = Form(False),
    page: int = Form(1),
    x: float = Form(40),
    y: float = Form(40),
    width: float = Form(220),
    height: float = Form(70),
):
    pfx_path = os.path.join(TMPDIR, f"cert_{secrets.token_hex(8)}.pfx")
    try:
        pdf_bytes = await _read_limited(pdf, "PDF")
        pfx_bytes = await _read_limited(pfx, "certificado")
        _validate_magic(pdf_bytes, b"%PDF", "PDF")

        # grava o PFX em tmpfs apenas para o load (pyHanko lê de caminho)
        with open(pfx_path, "wb") as f:
            f.write(pfx_bytes)

        try:
            signer = signers.SimpleSigner.load_pkcs12(
                pfx_file=pfx_path,
                passphrase=password.encode("utf-8"),
            )
        except Exception as e:  # senha errada / pfx corrompido / sem chave
            log.info("falha ao carregar PKCS#12 (%s)", type(e).__name__)
            raise SignError(
                "BAD_CERT",
                "Não foi possível abrir o certificado. Verifique o arquivo .pfx e a senha.",
                400,
            )
        if signer is None:
            raise SignError("BAD_CERT", "Certificado inválido ou senha incorreta.", 400)

        # ---- monta metadados PAdES conforme o nível pedido ----
        level = level.upper().strip()
        use_pades = level in ("B-T", "B-LT", "B-LTA")
        embed_validation = level in ("B-LT", "B-LTA")
        use_lta = level == "B-LTA"

        timestamper = None
        if tsa_url:
            timestamper = HTTPTimeStamper(url=tsa_url)
        elif level in ("B-T", "B-LT", "B-LTA"):
            # nível exige carimbo de tempo mas nenhuma TSA foi informada
            raise SignError(
                "TSA_REQUIRED",
                f"O nível {level} exige uma URL de carimbo de tempo (tsa_url).",
                400,
            )

        validation_context = ValidationContext(allow_fetching=True) if embed_validation else None

        signature_meta = signers.PdfSignatureMetadata(
            field_name="Signature1",
            subfilter=SigSeedSubFilter.PADES if use_pades else SigSeedSubFilter.ADOBE_PKCS7_DETACHED,
            embed_validation_info=embed_validation,
            use_pades_lta=use_lta,
            validation_context=validation_context,
            reason=reason,
            location=location,
            contact_info=contact,
        )

        stamp_style = TextStampStyle(stamp_text="Assinado por %(signer)s\n%(ts)s") if visible else None

        # ---- assina sobre incremental update (preserva integridade) ----
        out = io.BytesIO()
        writer = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))

        if visible:
            append_signature_field(
                writer,
                SigFieldSpec(
                    sig_field_name="Signature1",
                    on_page=page - 1,
                    box=(x, y, x + width, y + height),
                ),
            )

        pdf_signer = signers.PdfSigner(
            signature_meta,
            signer=signer,
            timestamper=timestamper,
            stamp_style=stamp_style,
        )

        try:
            pdf_signer.sign_pdf(writer, output=out)
        except Exception as e:
            log.exception("erro durante assinatura")
            # erros comuns: cert sem non-repudiation, TSA inacessível, etc.
            msg = "Falha ao assinar o documento."
            name = type(e).__name__
            if "Timestamp" in name or "timestamp" in str(e).lower():
                msg = "Não foi possível obter o carimbo de tempo (TSA indisponível)."
            raise SignError("SIGN_FAILED", msg, 502)

        out.seek(0)
        return StreamingResponse(
            out,
            media_type="application/pdf",
            headers={"Content-Disposition": 'attachment; filename="assinado.pdf"'},
        )

    except SignError as e:
        return JSONResponse(status_code=e.status, content={"code": e.code, "message": e.message})
    except HTTPException:
        raise
    except Exception:
        log.exception("erro inesperado")
        return JSONResponse(status_code=500, content={"code": "INTERNAL", "message": "Erro interno ao assinar."})
    finally:
        _shred(pfx_path)
        # zera a referência à senha
        password = "0" * len(password) if isinstance(password, str) else password
        del password
