# Design — Passe de production-ready do DocSign

> Data: 2026-06-02
> Escopo: um spec coeso cobrindo 4 frentes, implementadas em fases sequenciais.
> Documento mestre do projeto: `../../../../CLAUDE.md` (raiz) — este spec não revoga
> nenhum princípio inegociável de lá (fidelidade, robustez, segurança do certificado).

## Objetivo

Levar o DocSign de MVP funcional para um estado production-ready, fechando quatro
lacunas conhecidas (registradas no §0 do `CLAUDE.md`):

1. Versionamento (git) — o projeto ainda não está sob controle de versão.
2. Fila / limite de concorrência — proteger o LibreOffice (Gotenberg) de OOM.
3. Opções de assinatura — expor `reason`/`location`/`contact`, nível `B-LTA` e
   carimbo visível posicionável.
4. UI de verdade — shadcn/ui, drag-and-drop, preview do PDF, estados decentes.

## Princípios mantidos

- `app` (Next) continua sendo o único orquestrador e a única superfície pública.
- `gotenberg` e `signer` permanecem só na rede interna.
- `.pfx` e senha nunca tocam disco persistente, log, cache ou git.
- Todo erro vira `AppError` com mensagem PT-BR acionável; nada de 500 genérico.
- I/O externa passa por `withRetry` (só transitórios) com timeout.

---

## Fase 1 — Git (passo zero)

**O quê:** colocar o projeto sob controle de versão.

- `git init` na **raiz** do repositório (`DOCX_PDF/`), onde vive o `CLAUDE.md` mestre,
  com o código em `docx-pdf-signer/`.
- `.gitignore` cobrindo: `node_modules/`, `.next/`, `.env`, `*.pfx`, `*.p12`,
  `test-cert.pfx`, `.superpowers/`.
- **Versionar** `docs/superpowers/specs/` (documentação de design fica no repo).
  Apenas `.superpowers/` (mockups + estado do brainstorm) fica fora.
- Commit inicial com o estado atual do código + este spec.

**Critério de sucesso:** `git status` limpo após o commit inicial; nenhum segredo
(`.pfx`, `.env`) rastreado.

---

## Fase 2 — Fila / limite de concorrência

**Problema:** conversões DOCX→PDF pesadas e simultâneas podem estourar a memória do
LibreOffice dentro do Gotenberg. A assinatura (pyHanko) é leve e não precisa de fila.

**Componente novo:** `lib/semaphore.ts`

- Semáforo assíncrono em memória com fila FIFO de espera.
- API: `acquire(timeoutMs): Promise<release>` — resolve quando há vaga; rejeita com
  erro de timeout se a espera estourar.
- Interface clara: não conhece HTTP nem conversão; só controla N permissões.

**Integração:** envolve **apenas** `convertDocxToPdf` (em `lib/gotenberg.ts` ou na
route `/api/convert`). A aquisição acontece antes da chamada ao Gotenberg e o
`release` roda em `finally` (inclusive em erro).

**Configuração (env):**

- `MAX_CONCURRENT_CONVERSIONS` (default `2`)
- `QUEUE_TIMEOUT_MS` (default `30000`)

**Erro:** estouro de fila → `AppError("BUSY", "Servidor ocupado processando outras
conversões. Tente em instantes.", 503)`. Como é 503 (transitório), o `withRetry`
**não** deve reenvolver a fila a ponto de multiplicar a espera — a aquisição do
semáforo fica **fora** do `withRetry` (envolve a operação inteira uma vez).

**Trade-off conhecido (registrado de propósito):** o semáforo é **por processo**. Em
deploy multi-réplica (Swarm), o limite é por réplica, não global — o Gotenberg
compartilhado ainda pode ver `réplicas × N` conversões. Aceitável para o MVP; uma fila
global (Redis/fila dedicada) seria decisão de arquitetura futura, não improviso.

**Critério de sucesso:** com `MAX_CONCURRENT_CONVERSIONS=1`, duas conversões
concorrentes serializam; a segunda espera e completa. Com espera além do timeout,
retorna 503 com a mensagem PT-BR, sem temporário órfão.

---

## Fase 3 — Opções de assinatura

O `signer/main.py` **já aceita** `reason`, `location`, `contact`, `visible`, `page`,
`x`, `y`, `width`, `height` e os níveis `B-B`/`B-T`/`B-LT`/`B-LTA`. O trabalho está em
**encaminhar** tudo pelo caminho Next e validar.

**`app/api/sign/route.ts`:**

- Encaminhar, além do que já passa (`reason`, `location`, `visible`): `contact`,
  `page`, `x`, `y`, `width`, `height`, `level`.
- Validar antes de chamar o signer: `page ≥ 1`; `x`, `y`, `width`, `height` ≥ 0 quando
  `visible`; `level` ∈ `{B-B, B-T, B-LT, B-LTA}`. Erros → `AppError` 400 PT-BR.

**`lib/signer-client.ts`:**

- Ampliar o tipo `level` para `"B-B" | "B-T" | "B-LT" | "B-LTA"`.
- Incluir `contact` no `FormData` (já está na interface `SignParams`).

**Sistema de coordenadas (decisão-chave):**

- PDF usa origem no canto **inferior-esquerdo**, unidade em **points**.
- O preview no navegador (pdf.js) usa origem no **topo-esquerdo**, unidade em **px**.
- A conversão (inverter Y + aplicar a escala do viewport) acontece **no client**. O
  `/api/sign` recebe `x`, `y`, `width`, `height` **já em coordenadas-PDF** e apenas
  valida e repassa. Backend e signer permanecem sem lógica de coordenadas.
- Fórmula no client: dado o viewport do pdf.js (`scale`) e a altura da página em points
  `Hpts`, para um retângulo desenhado em px `(left, top, w, h)`:
  `x = left / scale`, `width = w / scale`, `height = h / scale`,
  `y = Hpts - (top / scale) - height`.

**Nível × TSA:** `B-T`/`B-LT`/`B-LTA` exigem `tsa_url`. O signer já devolve
`TSA_REQUIRED`; a **UI exige o campo TSA** sempre que o nível ≠ `B-B`, prevenindo o erro
antes do envio. `DEFAULT_TSA_URL` (env) pré-preenche quando disponível.

**Critério de sucesso:** assinar com carimbo visível posicionado e abrir o PDF no Adobe
Reader mostrando o selo na posição correta da página escolhida; `B-LTA` com TSA válida
produz assinatura com info de validação embutida.

---

## Fase 4 — UI de verdade

**Stack de UI:** shadcn/ui sobre o Tailwind já existente. Componentes previstos: Tabs,
Button, Input, Label, Select, Card, e Sonner (toasts). A skill `frontend-design` guia o
acabamento na implementação — paleta sóbria, hierarquia clara, sem estética genérica de
IA. Web worker do pdf.js servido **localmente** (sem CDN externo).

**Estrutura (escolha do usuário: abas no topo):**

- Abas: **Converter** / **Assinar** / **Converter+Assinar**.
- Cada aba renderiza só os campos do seu fluxo (já é o modelo do `app/page.tsx` atual,
  reescrito com shadcn).

**Dropzone:** componente próprio leve (`components/dropzone.tsx`) com eventos
drag-and-drop HTML5 — sem dependência extra. Valida extensão no client antes do upload.
Estados visuais: `idle → arrastando → enviando → na fila → processando → sucesso/erro`.

**Tratamento de erro:** lê a mensagem PT-BR do corpo `{code, message}` da API e mostra
em toast + inline. Nunca expõe status cru.

**Preview + carimbo (`pdfjs-dist`):**

- Quando "carimbo visível" está ligado (abas Assinar / Converter+Assinar), renderiza a
  página escolhida do PDF num `<canvas>` inline.
- Overlay com retângulo **arrastável e redimensionável**; seletor de página.
- Ao confirmar, converte as coordenadas (fórmula da Fase 3) e envia.
- **Fallback:** se o pdf.js falhar ao carregar/renderizar, cai para **presets de canto**
  (inferior-esq, inferior-dir, superior-esq, superior-dir) + seletor de página, que
  geram as coordenadas no client da mesma forma.

**Fluxo combinado com carimbo visível (decisão de fluxo):**

- O preview precisa de um PDF existente. No modo *Converter+Assinar* **com** carimbo
  visível: a UI **converte primeiro** (`/api/convert`), recebe o PDF, mostra o preview
  para posicionar, e só então chama `/api/sign`.
- Sem carimbo visível, o modo combinado segue em fluxo único (converte e assina sem
  parada para preview).

**Critério de sucesso:** arrastar um `.docx` na aba Converter baixa o PDF; assinar com
carimbo posicionado por drag funciona; mensagens de erro aparecem em PT-BR; o fluxo
combinado com carimbo pausa corretamente para o preview.

---

## Ordem de implementação

1. Fase 1 (git) — habilita commits incrementais das fases seguintes.
2. Fase 2 (fila) — isolada, sem dependência das outras.
3. Fase 3 (opções de assinatura) — backend/contratos, pré-requisito da UI de carimbo.
4. Fase 4 (UI) — consome os contratos da Fase 3.

## Fora de escopo (YAGNI)

- Fila global multi-réplica (Redis/fila dedicada).
- Cofre/persistência de certificados (KMS/HSM).
- Suite de testes automatizada (validação segue manual, conforme §9 do CLAUDE.md) —
  pode virar um spec próprio depois.
- Autenticação / multiusuário.
