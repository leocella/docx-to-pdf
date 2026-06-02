#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Smoke test E2E do DocSign.
# Roda na máquina COM Docker (a VPS do Rafael). Sobe os 3 serviços, espera
# ficarem saudáveis, gera um certificado A1 de teste + um .docx mínimo, e
# exercita /api/convert, /api/sign (B-B, carimbo visível) e os erros tratados.
#
# Uso (de dentro de docx-pdf-signer/):
#   bash scripts/smoke-test.sh                 # sobe, testa e DEIXA rodando
#   bash scripts/smoke-test.sh --down          # ao final, derruba os serviços
#   APP_URL=http://localhost:3001 bash scripts/smoke-test.sh
#
# Pré-requisitos: docker (com compose v2), curl, openssl, zip.
# Não persiste material sensível: o cert de teste vive em tmp e é apagado.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

APP_URL="${APP_URL:-http://localhost:3001}"
DOWN_AT_END=0
[ "${1:-}" = "--down" ] && DOWN_AT_END=1

# raiz do projeto = pasta-pai deste script (docx-pdf-signer/)
WORKDIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WORKDIR"

OUT="$WORKDIR/smoke-out"          # PDFs ficam aqui pra você inspecionar
mkdir -p "$OUT"
TMP="$(mktemp -d)"                # cert/docx/erros (apagado no fim)
PFX_PASS="teste123"

PASS=0; FAIL=0
ok(){   echo "  ✅ $1"; PASS=$((PASS+1)); }
bad(){  echo "  ❌ $1"; FAIL=$((FAIL+1)); }
info(){ echo ""; echo "▶ $1"; }

cleanup(){
  rm -rf "$TMP"
  if [ "$DOWN_AT_END" = "1" ]; then echo ""; echo "Derrubando serviços (--down)..."; docker compose down; fi
}
trap cleanup EXIT

# ── 0. pré-requisitos ────────────────────────────────────────────────────────
info "Checando pré-requisitos"
need(){ command -v "$1" >/dev/null 2>&1 || { echo "FALTA: $1"; exit 1; }; }
need docker; need curl; need openssl; need zip
docker compose version >/dev/null 2>&1 || { echo "FALTA: docker compose v2 (use 'docker compose', não 'docker-compose')"; exit 1; }
ok "docker, curl, openssl, zip presentes"

# ── 1. .env ──────────────────────────────────────────────────────────────────
[ -f .env ] || { cp .env.example .env; echo "  (criado .env a partir de .env.example)"; }

# ── 2. subir serviços ────────────────────────────────────────────────────────
info "Subindo serviços (docker compose up --build -d)"
docker compose up --build -d || { echo "Falha ao subir. Veja 'docker compose logs'."; exit 1; }

# ── 3. esperar /api/health = ok (LibreOffice demora a subir) ─────────────────
info "Aguardando /api/health ficar ok (até 180s)"
deadline=$((SECONDS+180))
until curl -sf "$APP_URL/api/health" 2>/dev/null | grep -q '"status":"ok"'; do
  if [ $SECONDS -ge $deadline ]; then
    bad "health não ficou ok em 180s"
    echo "── últimas linhas dos logs ──"; docker compose logs --tail=50
    exit 1
  fi
  sleep 3
done
ok "health ok ($(curl -s "$APP_URL/api/health"))"

# ── 4. certificado A1 de teste (autoassinado, NÃO use em produção) ───────────
info "Gerando certificado A1 de teste"
openssl req -x509 -newkey rsa:2048 -keyout "$TMP/k.pem" -out "$TMP/c.pem" -days 365 -nodes \
  -subj "/C=BR/ST=SC/L=Blumenau/O=Teste DocSign/CN=Assinatura Teste" \
  -addext "keyUsage=critical,nonRepudiation,digitalSignature" >/dev/null 2>&1
openssl pkcs12 -export -out "$TMP/test.pfx" -inkey "$TMP/k.pem" -in "$TMP/c.pem" \
  -passout "pass:$PFX_PASS" >/dev/null 2>&1
[ -f "$TMP/test.pfx" ] && ok "cert de teste gerado" || { bad "falha ao gerar cert"; exit 1; }

# ── 5. .docx mínimo válido (OOXML) ───────────────────────────────────────────
info "Gerando .docx de teste"
D="$TMP/docx"; mkdir -p "$D/_rels" "$D/word"
cat > "$D/[Content_Types].xml" <<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>
XML
cat > "$D/_rels/.rels" <<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>
XML
cat > "$D/word/document.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DocSign smoke test - documento de teste com acentuacao: ipsilon, cao, acao.</w:t></w:r></w:p></w:body></w:document>
XML
( cd "$D" && zip -q -X -r "$TMP/test.docx" "[Content_Types].xml" _rels word )
[ -f "$TMP/test.docx" ] && ok "docx de teste gerado" || { bad "falha ao gerar docx"; exit 1; }

# helper: POST multipart, captura HTTP code + corpo em arquivo
post(){ # $1=url  $2=out  resto=args do -F ; ecoa o http_code
  local url="$1" out="$2"; shift 2
  curl -s -o "$out" -w '%{http_code}' -X POST "$url" "$@"
}

# ── 6. /api/convert → PDF ────────────────────────────────────────────────────
info "POST /api/convert (DOCX → PDF)"
code=$(post "$APP_URL/api/convert" "$OUT/convertido.pdf" -F "file=@$TMP/test.docx")
if [ "$code" = "200" ] && head -c4 "$OUT/convertido.pdf" | grep -q '%PDF'; then
  ok "convert → PDF ($(wc -c <"$OUT/convertido.pdf") bytes) em smoke-out/convertido.pdf"
else
  bad "convert falhou (HTTP $code)"; head -c 300 "$OUT/convertido.pdf"; echo
fi

# ── 7. /api/sign B-B (sem TSA) ───────────────────────────────────────────────
info "POST /api/sign (nível B-B, sem carimbo visível)"
code=$(post "$APP_URL/api/sign" "$OUT/assinado.pdf" \
  -F "pdf=@$OUT/convertido.pdf" -F "pfx=@$TMP/test.pfx" -F "password=$PFX_PASS" -F "level=B-B")
if [ "$code" = "200" ] && head -c4 "$OUT/assinado.pdf" | grep -q '%PDF'; then
  ok "sign → PDF assinado em smoke-out/assinado.pdf"
else
  bad "sign falhou (HTTP $code)"; head -c 300 "$OUT/assinado.pdf"; echo
fi

# ── 8. /api/sign com carimbo visível ─────────────────────────────────────────
info "POST /api/sign (carimbo visível, página 1, canto inferior-esquerdo)"
code=$(post "$APP_URL/api/sign" "$OUT/assinado-carimbo.pdf" \
  -F "pdf=@$OUT/convertido.pdf" -F "pfx=@$TMP/test.pfx" -F "password=$PFX_PASS" -F "level=B-B" \
  -F "visible=true" -F "page=1" -F "x=40" -F "y=40" -F "width=200" -F "height=60")
if [ "$code" = "200" ] && head -c4 "$OUT/assinado-carimbo.pdf" | grep -q '%PDF'; then
  ok "sign visível → smoke-out/assinado-carimbo.pdf (abra e confira o selo)"
else
  bad "sign visível falhou (HTTP $code)"; head -c 300 "$OUT/assinado-carimbo.pdf"; echo
fi

# ── 9. erro: senha errada (espera 400 + JSON PT-BR) ──────────────────────────
info "POST /api/sign com senha ERRADA (espera erro tratado, não 500)"
code=$(post "$APP_URL/api/sign" "$TMP/err1.json" \
  -F "pdf=@$OUT/convertido.pdf" -F "pfx=@$TMP/test.pfx" -F "password=SENHA_ERRADA" -F "level=B-B")
if [ "$code" = "400" ] && grep -q '"code"' "$TMP/err1.json"; then
  ok "senha errada → HTTP 400 tratado: $(cat "$TMP/err1.json")"
else
  bad "esperava 400 com JSON {code,message}; veio HTTP $code"; cat "$TMP/err1.json"; echo
fi

# ── 10. erro: B-T sem TSA (espera TSA_REQUIRED) ──────────────────────────────
info "POST /api/sign B-T sem TSA (espera TSA_REQUIRED)"
code=$(post "$APP_URL/api/sign" "$TMP/err2.json" \
  -F "pdf=@$OUT/convertido.pdf" -F "pfx=@$TMP/test.pfx" -F "password=$PFX_PASS" -F "level=B-T")
if [ "$code" = "400" ] && grep -q 'TSA_REQUIRED' "$TMP/err2.json"; then
  ok "B-T sem TSA → TSA_REQUIRED"
else
  bad "esperava 400 TSA_REQUIRED; veio HTTP $code: $(cat "$TMP/err2.json")"
fi

# ── 11. erro: arquivo inválido em convert (espera 415) ───────────────────────
info "POST /api/convert com arquivo NÃO-docx (espera 415)"
echo "isto nao e um docx" > "$TMP/fake.docx"
code=$(post "$APP_URL/api/convert" "$TMP/err3.json" -F "file=@$TMP/fake.docx")
if [ "$code" = "415" ]; then
  ok "arquivo inválido → HTTP 415 (magic bytes barraram)"
else
  bad "esperava 415; veio HTTP $code: $(cat "$TMP/err3.json")"
fi

# ── resumo ───────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "   PASSOU: $PASS    FALHOU: $FAIL"
echo "═══════════════════════════════════════"
echo "PDFs gerados em: $OUT/"
echo "  - convertido.pdf         (DOCX→PDF)"
echo "  - assinado.pdf           (assinatura invisível)"
echo "  - assinado-carimbo.pdf   (assinatura com selo visível — confira a posição)"
echo ""
if [ "$DOWN_AT_END" != "1" ]; then
  echo "Serviços continuam no ar. UI: $APP_URL"
  echo "Para derrubar: docker compose down"
fi
[ $FAIL -eq 0 ] && { echo "🎉 Tudo verde!"; exit 0; } || { echo "⚠ Há falhas acima. Investigue com: docker compose logs"; exit 1; }
