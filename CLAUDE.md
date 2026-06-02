# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# DocSign — Conversão DOCX→PDF + Assinatura Digital

> Documento de contexto para o Claude Code. Leia inteiro antes de codar.
> Objetivo do produto: web app **robusto** que (1) converte `.docx` em PDF com **alta fidelidade** e (2) assina PDFs com **certificado digital A1 (ICP-Brasil)** no padrão **PAdES**.

---

## 0. Navegação e estado atual (leia primeiro)

**Todo o código fica em `docx-pdf-signer/`** — a raiz do repositório (`DOCX_PDF`) só contém este `CLAUDE.md` e a pasta do projeto. Comandos `npm`/`docker compose` **só funcionam de dentro de `docx-pdf-signer/`** (`cd docx-pdf-signer` antes). Não é um repositório git.

> O `docx-pdf-signer/CLAUDE.md` é apenas um ponteiro para este arquivo — mantenha o conteúdo **só aqui** para evitar divergência.

**Mapa dos arquivos** (todos relativos a `docx-pdf-signer/`):

| Caminho | Papel |
|---|---|
| `app/page.tsx` | UI single-page, client component. Três modos: Converter / Assinar / Converter+Assinar. |
| `app/api/convert/route.ts` | Recebe `.docx` (campo `file`), chama Gotenberg, devolve PDF. |
| `app/api/sign/route.ts` | Recebe `pdf`+`pfx`+`password`(+opções), chama o signer, devolve PDF assinado. |
| `app/api/health/route.ts` | Agrega health de Gotenberg + signer (`degraded`/503 se algum cair). |
| `lib/errors.ts` | `AppError` (code/userMessage PT-BR/httpStatus) + `toAppError`. **Único** padrão de erro. |
| `lib/retry.ts` | `withRetry` — backoff+jitter, só re-tenta transitórios (5xx/timeout/ECONN…). |
| `lib/validation.ts` | `readAndValidate` — limite de tamanho + magic bytes (`PK␃␄` docx, `%PDF`). |
| `lib/gotenberg.ts` | Cliente Gotenberg (`convertDocxToPdf`, `gotenbergHealthy`). |
| `lib/signer-client.ts` | Cliente do signer (`signPdf`, `signerHealthy`). |
| `signer/main.py` | FastAPI + pyHanko. `POST /sign`, `GET /health`. Único arquivo Python. |
| `scripts/gen-test-cert.sh` | Gera `.pfx` autoassinado de teste (bash/openssl — usar via WSL/Git Bash no Windows). |

**Já implementado:** os 3 serviços, todas as rotas Next, o cliente/retry/validação, o signer (B-B → B-T → B-LT → B-LTA), docker-compose com healthchecks, shred do `.pfx` em tmpfs. As tarefas do §7 e os checkboxes do §5 estão, em sua maioria, **concluídos** — trate-os como referência de requisitos, não como TODO.

**Lacunas conhecidas (spec × realidade) — confira antes de assumir que existe:**
- **UI é um MVP mínimo** em Tailwind puro: sem shadcn/ui, sem drag-and-drop, sem posicionamento de carimbo visível. O §2/§7 menciona shadcn e `frontend-design`, mas nada disso foi instalado/aplicado ainda.
- **Sem testes automatizados.** `package.json` tem só `dev`/`build`/`start`/`lint`; não há jest/vitest/playwright nem `pytest`. O §9 descreve testes **manuais**.
- **Sem fila/limite de concorrência** (§5 e §7.6) — ainda não existe.
- `app/api/sign/route.ts` não encaminha `contact` nem opções de carimbo visível; a UI não expõe `reason`/`location`/`visible`. O tipo TS em `signer-client.ts` aceita só `B-B|B-T|B-LT`, mas o signer Python também trata `B-LTA`.
- `next lint` está no `package.json`, mas não há config ESLint commitada — confirme antes de confiar nele.

---

## 1. Princípios inegociáveis

Estes três pontos definem se o produto presta ou não. Toda decisão técnica deve servir a eles.

1. **Fidelidade de conversão.** O PDF gerado deve ser visualmente idêntico ao DOCX (layout, tabelas, quebras de página, fontes, cabeçalho/rodapé, numeração). Por isso a conversão usa **LibreOffice headless via Gotenberg**, e não bibliotecas JS de renderização (mammoth/puppeteer perdem fidelidade). Nunca substituir o motor de conversão por um caminho "mais simples" sem aprovação.
2. **Robustez contra falhas.** Toda chamada externa (Gotenberg, serviço de assinatura, TSA) tem timeout, retry com backoff exponencial e erro estruturado. Nenhuma exceção pode vazar como 500 genérico para o usuário. Arquivos temporários sempre são limpos, inclusive em caminho de erro.
3. **Segurança do certificado.** O `.pfx`/`.p12` e sua senha são material criptográfico sensível. **Nunca** persistir em disco, log, banco ou cache. Vivem só em memória/tmpfs durante a requisição e são destruídos no `finally`. Senha nunca aparece em log.

---

## 2. Arquitetura

Três serviços, um `docker-compose`. Comunicação interna por rede Docker; nada de TSA/Gotenberg exposto à internet.

```
┌─────────────────────────────────────────────────────────┐
│  Next.js (app)  — UI + API routes de orquestração        │
│  - /api/convert  → orquestra DOCX→PDF                     │
│  - /api/sign     → orquestra assinatura PAdES             │
│  - /api/health   → agrega health dos serviços            │
└───────────┬───────────────────────────┬─────────────────┘
            │ multipart/form-data        │ multipart/form-data
            ▼                            ▼
┌────────────────────────┐   ┌──────────────────────────────┐
│  gotenberg (LibreOffice)│   │  signer (FastAPI + pyHanko)   │
│  DOCX/100+ fmt → PDF    │   │  PAdES B-T / B-LT, A1, TSA    │
└────────────────────────┘   └──────────────────────────────┘
```

**Por que essa divisão.** A conversão fiel exige LibreOffice (binário pesado, melhor isolado num container pronto). A assinatura PAdES robusta no contexto brasileiro é melhor servida por `pyHanko` (Python), que faz B-LT/LTA, carimbo de tempo RFC 3161 e validação de chain — superior a `node-signpdf`. O Next.js fica como orquestrador fino e única superfície pública.

### Stack
- **Frontend/orquestração:** Next.js 15 (App Router), TypeScript estrito, Tailwind, shadcn/ui. UI seguindo a skill `frontend-design` (sem estética genérica de IA).
- **Conversão:** `gotenberg/gotenberg:8` (variante com LibreOffice).
- **Assinatura:** Python 3.12 + FastAPI + `pyHanko`.
- **Deploy alvo:** Docker Swarm na infraCella (Traefik na frente do serviço `app` apenas).

---

## 3. Convenções de código

- TypeScript com `strict: true`. Sem `any` solto; use tipos de erro discriminados.
- Erros nunca silenciados: padronizar em `lib/errors.ts` (`AppError` com `code`, `httpStatus`, `userMessage` em PT-BR, `cause`).
- Toda I/O externa passa por `lib/retry.ts` (backoff exponencial + jitter, idempotência respeitada).
- API routes Next: validar entrada (mime real por magic bytes, tamanho) **antes** de chamar serviço a jusante.
- Logs estruturados (JSON). **Proibido** logar conteúdo de arquivo, senha de certificado ou bytes do `.pfx`.
- Python: type hints, `ruff` limpo, sem `print` (usar `logging`), sem segredo em log.
- Mensagens ao usuário em **português**; identificadores/código em inglês.
- Sem n8n no caminho de produção — rotas de API diretas (preferência do projeto).

---

## 4. Contratos de API (internos)

### `signer` (FastAPI) — `POST /sign`
`multipart/form-data`:
- `pdf`: arquivo PDF (obrigatório)
- `pfx`: arquivo `.pfx`/`.p12` (obrigatório)
- `password`: senha do PFX (obrigatório, form field)
- `tsa_url`: URL do carimbo de tempo RFC 3161 (opcional; default = sem TSA → PAdES B-B)
- `level`: `B-B` | `B-T` | `B-LT` (default `B-T` quando há `tsa_url`)
- `reason`, `location`, `contact`: metadados (opcionais)
- `visible`: bool; se true, `page`, `x`, `y`, `width`, `height` posicionam o carimbo visual
Resposta: `application/pdf` (stream) ou JSON de erro `{code, message}`.
`GET /health` → `{status:"ok"}`.

### `gotenberg` — `POST /forms/libreoffice/convert`
`multipart/form-data` com campo `files` = o `.docx`. Resposta: `application/pdf`.
(Documentação: rota oficial do LibreOffice no Gotenberg 8.)

### Next.js (público)
- `POST /api/convert` → recebe `.docx`, devolve PDF.
- `POST /api/sign` → recebe `pdf` + `pfx` + `password` (+ opções), devolve PDF assinado.
- `GET /api/health` → agrega health de `gotenberg` e `signer`.

---

## 5. Robustez — checklist obrigatório

- [ ] Validação de upload: tamanho máximo (`MAX_UPLOAD_MB`, default 25), mime real por magic bytes (`PK\x03\x04` para docx, `%PDF` para pdf), nome saneado.
- [ ] Timeout por chamada (`GOTENBERG_TIMEOUT_MS`, `SIGNER_TIMEOUT_MS`).
- [ ] Retry com backoff (3 tentativas, jitter) só em erros transitórios (5xx, timeout, ECONNRESET) — **nunca** em 4xx.
- [ ] Health checks no compose com `start_period` generoso (LibreOffice demora a subir).
- [ ] Limpeza de temporários em `finally`, inclusive `.pfx`.
- [ ] Erros mapeados para mensagens PT-BR acionáveis (ex.: "Senha do certificado incorreta", "Certificado expirado", "Arquivo .docx corrompido").
- [ ] Limite de concorrência / fila simples para conversões pesadas (evitar OOM no LibreOffice).
- [ ] `app` é o único serviço exposto; `gotenberg` e `signer` só na rede interna.

---

## 6. Segurança do certificado — regras

- O `.pfx` chega via `multipart`, é gravado em **tmpfs** (`/dev/shm`) ou mantido em memória, usado e **apagado** (`os.unlink` + sobrescrita) no `finally`.
- A senha trafega só no corpo da requisição (sob TLS/Traefik), nunca em query string, nunca logada.
- Nada de armazenar certificado entre requisições neste MVP. Se um dia houver "cofre", será decisão de arquitetura separada (KMS/HSM), não improviso.
- pyHanko exige por padrão o bit de key usage **non-repudiation**; certificados A1 ICP-Brasil (e-CPF/e-CNPJ) atendem. Não desabilitar essa checagem sem motivo.

---

## 7. Tarefas (ordem sugerida de execução)

1. **Infra base:** `docker-compose.yml`, `.env`, healthchecks subindo (`docker compose up`), `GET /api/health` verde.
2. **Serviço signer:** implementar `POST /sign` com pyHanko (B-B → B-T com TSA → B-LT). Testar com um PFX de teste autoassinado gerado por script.
3. **Conversão:** `lib/gotenberg.ts` + `POST /api/convert` com retry/timeout. Testar fidelidade com DOCX real (tabelas, imagens, cabeçalho).
4. **Orquestração de assinatura:** `POST /api/sign` chamando o signer.
5. **UI:** página única com dois fluxos (Converter / Assinar) e um fluxo combinado (Converter → Assinar). Drag-and-drop, estados de loading/erro/sucesso, download. Usar skill `frontend-design`.
6. **Hardening:** limites, fila de concorrência, mensagens de erro, e2e.

---

## 8. Comandos

> Rodar **de dentro de `docx-pdf-signer/`** (`cd docx-pdf-signer`).

```bash
# Subir tudo (dev) — requer Docker
docker compose up --build

# Só os serviços de apoio, rodando o Next localmente
docker compose up gotenberg signer
npm install        # primeira vez
npm run dev        # http://localhost:3001
npm run build      # build de produção (standalone, usado no Dockerfile)
npm run lint       # next lint (sem config ESLint commitada — verificar)

# Não há suite de testes automatizada. Validação é manual (ver §9).

# Testar conversão direto no Gotenberg (descomente a porta do gotenberg no compose antes)
curl --request POST http://localhost:3000/forms/libreoffice/convert \
  --form files=@exemplo.docx -o saida.pdf

# Gerar PFX de teste (NÃO usar em produção) — bash + openssl (WSL/Git Bash no Windows)
./scripts/gen-test-cert.sh minhasenha   # gera test-cert.pfx
```

Portas: `app` 3001, `gotenberg` 3000, `signer` 8000 (todas internas exceto `app`; gotenberg/signer não publicam porta por padrão).

---

## 9. Testes

- **Fidelidade:** corpus de DOCX (tabela complexa, imagem flutuante, cabeçalho/rodapé, fonte custom, quebra de seção). Conferência visual + checagem de nº de páginas.
- **Assinatura:** validar o PDF assinado com `pyhanko sign validate` e abrir no Adobe Reader (deve mostrar painel de assinatura). Testar senha errada, cert expirado, PFX inválido, TSA fora do ar.
- **Robustez:** derrubar `gotenberg` no meio → erro tratado, sem temporário órfão. Arquivo > limite → 413 com mensagem clara.

---

## 10. Variáveis de ambiente

Ver `.env.example`. Resumo:
- `GOTENBERG_URL`, `SIGNER_URL`
- `GOTENBERG_TIMEOUT_MS`, `SIGNER_TIMEOUT_MS`
- `MAX_UPLOAD_MB`
- `DEFAULT_TSA_URL` (TSA ICP-Brasil ou outro RFC 3161; opcional)

---

## 11. O que NÃO fazer

- Não trocar Gotenberg por conversão JS "pra simplificar".
- Não persistir `.pfx` nem senha em lugar algum.
- Não expor `gotenberg`/`signer` à internet.
- Não inventar quotes/atribuições; não logar conteúdo de documentos.
- Não introduzir n8n no caminho de produção.
