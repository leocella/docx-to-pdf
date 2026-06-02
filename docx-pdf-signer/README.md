# DocSign — Conversão DOCX→PDF + Assinatura Digital

Web app robusto que converte `.docx` em PDF com alta fidelidade (LibreOffice via Gotenberg)
e assina PDFs com certificado A1 ICP-Brasil no padrão PAdES (pyHanko).

## Stack
- **app**: Next.js 15 (orquestração + UI) — único serviço público
- **gotenberg**: LibreOffice headless (conversão fiel)
- **signer**: FastAPI + pyHanko (PAdES B-B/B-T/B-LT, carimbo de tempo, A1)

## Rodar
```bash
cp .env.example .env
docker compose up --build
# app em http://localhost:3001
```

## Testar assinatura sem certificado real
```bash
./scripts/gen-test-cert.sh minhasenha   # gera test-cert.pfx
```

## Construir com o Claude Code
Leia `CLAUDE.md` — é o documento mestre com arquitetura, contratos de API,
checklist de robustez, regras de segurança do certificado e ordem de tarefas.

## Segurança
- `.pfx` e senha nunca são persistidos (tmpfs, destruídos no `finally`).
- `gotenberg` e `signer` ficam só na rede interna; só `app` é exposto (Traefik).
