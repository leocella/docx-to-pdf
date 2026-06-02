# Passe de Production-Ready do DocSign — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o DocSign de MVP a production-ready em 4 fases: versionar (git), proteger o LibreOffice com fila de concorrência, expor todas as opções de assinatura (incl. carimbo visível posicionável e nível B-LTA), e reconstruir a UI com shadcn/ui + drag-and-drop + preview de PDF.

**Architecture:** O `app` Next continua sendo o único orquestrador público; `gotenberg` e `signer` ficam na rede interna. A fila é um semáforo em memória no processo Next que envolve só a conversão. A conversão de coordenadas do carimbo (px do navegador → points do PDF) acontece no client; o backend só valida e repassa. `.pfx`/senha nunca tocam disco persistente nem log.

**Tech Stack:** Next.js 15 (App Router, TS estrito), Tailwind + shadcn/ui, `pdfjs-dist` (preview/drag do carimbo), `sonner` (toasts), FastAPI + pyHanko (signer, já pronto), Gotenberg 8 (conversão, já pronto).

**Verificação:** Este projeto **não tem suite automatizada** (decisão do spec — validação manual, ver `CLAUDE.md §9`). Os passos de verificação são comandos (`docker compose`, `curl`) e inspeção no navegador. Todos os comandos rodam **de dentro de `docx-pdf-signer/`** salvo indicação contrária.

**Spec de referência:** `docs/superpowers/specs/2026-06-02-production-ready-pass-design.md`

---

## Estrutura de arquivos

**Fase 1 (git):**
- Criar: `../.gitignore` (na raiz `DOCX_PDF/`)

**Fase 2 (fila):**
- Criar: `lib/semaphore.ts` — semáforo assíncrono genérico (FIFO + timeout)
- Criar: `lib/conversion-queue.ts` — singleton do semáforo + `withConversionSlot`
- Modificar: `app/api/convert/route.ts` — envolver a conversão na fila
- Modificar: `.env.example`, `docker-compose.yml` — novas envs

**Fase 3 (opções de assinatura):**
- Modificar: `lib/signer-client.ts` — tipo `level` inclui `B-LTA`
- Modificar: `app/api/sign/route.ts` — ler/validar/encaminhar `contact`, `page`, `x`, `y`, `width`, `height`, `level`, `tsa_url`

**Fase 4 (UI):**
- Modificar: `package.json` (deps), `tailwind.config.ts`, `app/globals.css`, `app/layout.tsx`
- Criar: `components.json`, `lib/utils.ts`
- Criar: `components/ui/button.tsx`, `components/ui/tabs.tsx`, `components/ui/input.tsx`, `components/ui/label.tsx`
- Criar: `lib/api-client.ts` — helpers `postForm`/`download`
- Criar: `lib/coords.ts` — conversão px→PDF e presets
- Criar: `components/dropzone.tsx` — upload drag-and-drop
- Criar: `components/stamp-positioner.tsx` — preview pdf.js + retângulo arrastável + fallback presets
- Criar: `components/convert-tab.tsx`, `components/sign-tab.tsx`, `components/combined-tab.tsx`
- Reescrever: `app/page.tsx` — só monta as abas

---

## Fase 1 — Git

### Task 1: Inicializar repositório e commit inicial

**Files:**
- Create: `../.gitignore`

- [ ] **Step 1: Criar `.gitignore` na raiz do repositório**

Caminho: `C:\Users\leo-p\OneDrive\Documentos\DOCX_PDF\.gitignore`

```gitignore
# deps / build
node_modules/
.next/
out/
dist/

# env e segredos — NUNCA versionar
.env
.env.local
*.pfx
*.p12
test-cert.pfx

# brainstorm visual companion (mockups/estado) — specs ficam versionados
.superpowers/

# OS
.DS_Store
Thumbs.db
```

- [ ] **Step 2: Inicializar git na raiz**

Run (na raiz `DOCX_PDF/`):
```bash
git init
git add -A
git status
```
Expected: `CLAUDE.md`, `docx-pdf-signer/...` e `docx-pdf-signer/docs/superpowers/specs/...` staged. **Confirmar que NENHUM `.pfx`, `.env` ou `.superpowers/` aparece** na lista.

- [ ] **Step 3: Commit inicial**

```bash
git commit -m "chore: versão inicial do DocSign + spec do passe production-ready

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Expected: commit criado; `git status` limpo.

---

## Fase 2 — Fila / limite de concorrência

### Task 2: Semáforo assíncrono

**Files:**
- Create: `lib/semaphore.ts`

- [ ] **Step 1: Escrever `lib/semaphore.ts`**

```ts
// Semáforo assíncrono genérico, em memória, com fila FIFO e timeout de espera.
// Não conhece HTTP nem conversão — só controla N permissões concorrentes.
export interface Semaphore {
  /** Resolve com uma função `release` quando há vaga. Rejeita com Error("QUEUE_TIMEOUT") se a espera estourar. */
  acquire(timeoutMs: number): Promise<() => void>;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createSemaphore(max: number): Semaphore {
  let active = 0;
  const queue: Waiter[] = [];

  // Cada release é idempotente: só age na primeira chamada.
  const makeRelease = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = queue.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve(makeRelease()); // passa a vaga adiante; active não muda
      } else {
        active -= 1;
      }
    };
  };

  return {
    acquire(timeoutMs: number): Promise<() => void> {
      if (active < max) {
        active += 1;
        return Promise.resolve(makeRelease());
      }
      return new Promise<() => void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = queue.findIndex((w) => w.timer === timer);
          if (idx >= 0) queue.splice(idx, 1);
          reject(new Error("QUEUE_TIMEOUT"));
        }, timeoutMs);
        queue.push({ resolve, reject, timer });
      });
    },
  };
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add docx-pdf-signer/lib/semaphore.ts
git commit -m "feat: semáforo assíncrono em memória com fila FIFO e timeout"
```

### Task 3: Fila de conversão e integração na rota

**Files:**
- Create: `lib/conversion-queue.ts`
- Modify: `app/api/convert/route.ts`
- Modify: `.env.example`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Escrever `lib/conversion-queue.ts`**

```ts
import { createSemaphore } from "./semaphore";
import { AppError } from "./errors";

const MAX = Number(process.env.MAX_CONCURRENT_CONVERSIONS ?? 2);
const QUEUE_TIMEOUT_MS = Number(process.env.QUEUE_TIMEOUT_MS ?? 30_000);

// Singleton do processo: limita conversões simultâneas no Gotenberg/LibreOffice.
const sem = createSemaphore(MAX);

/** Roda `fn` ocupando uma vaga da fila. Lança AppError("BUSY", 503) se a espera estourar. */
export async function withConversionSlot<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  try {
    release = await sem.acquire(QUEUE_TIMEOUT_MS);
  } catch {
    throw new AppError(
      "BUSY",
      "Servidor ocupado processando outras conversões. Tente em instantes.",
      503,
    );
  }
  try {
    return await fn();
  } finally {
    release();
  }
}
```

- [ ] **Step 2: Integrar na rota `app/api/convert/route.ts`**

Substituir o corpo do `POST` para envolver a conversão na fila. O arquivo inteiro fica:

```ts
import { NextRequest } from "next/server";
import { convertDocxToPdf } from "@/lib/gotenberg";
import { withConversionSlot } from "@/lib/conversion-queue";
import { readAndValidate } from "@/lib/validation";
import { toAppError } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const { bytes, name } = await readAndValidate(form.get("file") as File | null, "docx", "documento .docx");

    // A aquisição da vaga envolve a operação inteira UMA vez (fora do withRetry interno).
    const pdf = await withConversionSlot(() => convertDocxToPdf(bytes, name));
    const outName = name.replace(/\.docx$/i, "") + ".pdf";

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${outName}"`,
      },
    });
  } catch (err) {
    return toAppError(err).toResponse();
  }
}
```

- [ ] **Step 3: Adicionar envs em `.env.example`**

Acrescentar ao final:
```dotenv

# Fila de conversão (protege o LibreOffice de OOM)
MAX_CONCURRENT_CONVERSIONS=2
QUEUE_TIMEOUT_MS=30000
```

- [ ] **Step 4: Passar as envs ao serviço `app` no `docker-compose.yml`**

No bloco `app:` → `environment:`, adicionar abaixo de `MAX_UPLOAD_MB=25`:
```yaml
      - MAX_CONCURRENT_CONVERSIONS=2
      - QUEUE_TIMEOUT_MS=30000
```

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Verificação manual da serialização**

Run:
```bash
MAX_CONCURRENT_CONVERSIONS=1 docker compose up --build -d
# dispara duas conversões ao mesmo tempo de um .docx de teste
curl -s -X POST http://localhost:3001/api/convert -F "file=@exemplo.docx" -o a.pdf &
curl -s -X POST http://localhost:3001/api/convert -F "file=@exemplo.docx" -o b.pdf &
wait
ls -la a.pdf b.pdf
```
Expected: ambos os PDFs gerados; nos logs (`docker compose logs app`) as conversões não se sobrepõem (a segunda começa após a primeira liberar a vaga). Com `QUEUE_TIMEOUT_MS=1` e o serviço ocupado, a segunda deve retornar `{"code":"BUSY",...}` com HTTP 503.

- [ ] **Step 7: Commit**

```bash
git add docx-pdf-signer/lib/conversion-queue.ts docx-pdf-signer/app/api/convert/route.ts docx-pdf-signer/.env.example docx-pdf-signer/docker-compose.yml
git commit -m "feat: fila de concorrência para conversões (semáforo + timeout 503)"
```

---

## Fase 3 — Opções de assinatura

### Task 4: Ampliar o nível no cliente do signer

**Files:**
- Modify: `lib/signer-client.ts:13`

- [ ] **Step 1: Incluir `B-LTA` no tipo `level`**

Em `lib/signer-client.ts`, na interface `SignParams`, trocar a linha:
```ts
  level?: "B-B" | "B-T" | "B-LT";
```
por:
```ts
  level?: "B-B" | "B-T" | "B-LT" | "B-LTA";
```

(O `contact`, `page`, `x`, `y`, `width`, `height` já são montados no `FormData` deste arquivo — não mexer no resto.)

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add docx-pdf-signer/lib/signer-client.ts
git commit -m "feat: aceitar nível PAdES B-LTA no cliente do signer"
```

### Task 5: Encaminhar e validar opções na rota `/api/sign`

**Files:**
- Modify: `app/api/sign/route.ts`

- [ ] **Step 1: Reescrever `app/api/sign/route.ts` para ler, validar e repassar todas as opções**

```ts
import { NextRequest } from "next/server";
import { signPdf, type SignParams } from "@/lib/signer-client";
import { readAndValidate } from "@/lib/validation";
import { AppError, toAppError } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 120;

const LEVELS = ["B-B", "B-T", "B-LT", "B-LTA"] as const;
type Level = (typeof LEVELS)[number];

function num(form: FormData, key: string): number | undefined {
  const v = form.get(key);
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    const pdf = await readAndValidate(form.get("pdf") as File | null, "pdf", "PDF");
    const pfxFile = form.get("pfx") as File | null;
    const password = String(form.get("password") ?? "");

    if (!pfxFile || pfxFile.size === 0) throw new AppError("MISSING_CERT", "Envie o certificado .pfx.", 400);
    if (!password) throw new AppError("MISSING_PASSWORD", "Informe a senha do certificado.", 400);

    const pfxBytes = new Uint8Array(await pfxFile.arrayBuffer());

    const rawLevel = String(form.get("level") ?? "B-T").toUpperCase() as Level;
    if (!LEVELS.includes(rawLevel)) throw new AppError("INVALID_LEVEL", "Nível de assinatura inválido.", 400);

    const tsaUrl = (form.get("tsa_url") as string | null) || process.env.DEFAULT_TSA_URL || undefined;
    if (rawLevel !== "B-B" && !tsaUrl) {
      throw new AppError("TSA_REQUIRED", `O nível ${rawLevel} exige uma URL de carimbo de tempo (TSA).`, 400);
    }

    const visible = form.get("visible") === "true";
    const params: SignParams = {
      pdf: pdf.bytes,
      pfx: pfxBytes,
      password,
      tsaUrl,
      level: rawLevel,
      reason: (form.get("reason") as string | null) ?? undefined,
      location: (form.get("location") as string | null) ?? undefined,
      contact: (form.get("contact") as string | null) ?? undefined,
      visible,
    };

    if (visible) {
      const page = num(form, "page");
      const x = num(form, "x");
      const y = num(form, "y");
      const width = num(form, "width");
      const height = num(form, "height");
      for (const [k, v] of Object.entries({ page, x, y, width, height })) {
        if (v === undefined || Number.isNaN(v) || (v as number) < 0) {
          throw new AppError("INVALID_STAMP", `Posição do carimbo inválida (${k}).`, 400);
        }
      }
      if ((page as number) < 1) throw new AppError("INVALID_STAMP", "A página do carimbo deve ser ≥ 1.", 400);
      Object.assign(params, { page, x, y, width, height });
    }

    const signed = await signPdf(params);
    const outName = pdf.name.replace(/\.pdf$/i, "") + "-assinado.pdf";
    return new Response(new Uint8Array(signed), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${outName}"`,
      },
    });
  } catch (err) {
    return toAppError(err).toResponse();
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Verificação manual (carimbo visível + B-LTA)**

Run (com os serviços no ar e um `test-cert.pfx` gerado por `./scripts/gen-test-cert.sh teste123` e um `doc.pdf`):
```bash
curl -s -X POST http://localhost:3001/api/sign \
  -F "pdf=@doc.pdf" -F "pfx=@test-cert.pfx" -F "password=teste123" \
  -F "level=B-B" -F "visible=true" \
  -F "page=1" -F "x=40" -F "y=40" -F "width=200" -F "height=60" \
  -o assinado.pdf && echo "OK"
```
Expected: `assinado.pdf` gerado; abrir no leitor de PDF mostra o selo no canto inferior-esquerdo da página 1. Enviar `level=B-T` sem `tsa_url` (e sem `DEFAULT_TSA_URL`) deve retornar `{"code":"TSA_REQUIRED",...}` 400.

- [ ] **Step 4: Commit**

```bash
git add docx-pdf-signer/app/api/sign/route.ts
git commit -m "feat: encaminhar e validar opções de assinatura (carimbo, contact, nível, TSA)"
```

---

## Fase 4 — UI

### Task 6: Base do shadcn/ui (deps, tokens, componentes)

**Files:**
- Modify: `package.json`, `tailwind.config.ts`, `app/globals.css`, `app/layout.tsx`
- Create: `lib/utils.ts`, `components.json`, `components/ui/button.tsx`, `components/ui/tabs.tsx`, `components/ui/input.tsx`, `components/ui/label.tsx`

- [ ] **Step 1: Instalar dependências**

Run:
```bash
npm install class-variance-authority clsx tailwind-merge tailwindcss-animate lucide-react sonner @radix-ui/react-tabs @radix-ui/react-label pdfjs-dist
```
Expected: instala sem erro; `package.json` atualizado.

- [ ] **Step 2: Criar `lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 3: Criar `components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": { "components": "@/components", "utils": "@/lib/utils" }
}
```

- [ ] **Step 4: Substituir `app/globals.css` com os tokens de tema**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 240 10% 3.9%;
    --card: 0 0% 100%;
    --card-foreground: 240 10% 3.9%;
    --primary: 240 5.9% 10%;
    --primary-foreground: 0 0% 98%;
    --secondary: 240 4.8% 95.9%;
    --secondary-foreground: 240 5.9% 10%;
    --muted: 240 4.8% 95.9%;
    --muted-foreground: 240 3.8% 46.1%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 5.9% 90%;
    --input: 240 5.9% 90%;
    --ring: 240 5.9% 10%;
    --radius: 0.6rem;
  }
}

@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground; }
}
```

- [ ] **Step 5: Substituir `tailwind.config.ts` para mapear os tokens**

```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
```

- [ ] **Step 6: Criar `components/ui/button.tsx`**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-input bg-background hover:bg-secondary",
        ghost: "hover:bg-secondary",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      },
      size: { default: "h-10 px-4 py-2", sm: "h-9 px-3", lg: "h-11 px-8", icon: "h-10 w-10" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

- [ ] **Step 7: Criar `components/ui/input.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
```

- [ ] **Step 8: Criar `components/ui/label.tsx`**

```tsx
"use client";
import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
```

- [ ] **Step 9: Criar `components/ui/tabs.tsx`**

```tsx
"use client";
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("inline-flex h-10 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground", className)}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
```

- [ ] **Step 10: Registrar o Toaster do sonner em `app/layout.tsx`**

Substituir o arquivo por:
```tsx
import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocSign — Converter e Assinar PDF",
  description: "Converte DOCX em PDF com fidelidade e assina com certificado A1 (ICP-Brasil).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
```

- [ ] **Step 11: Verificar build/tipos**

Run: `npx tsc --noEmit && npm run build`
Expected: build conclui sem erros.

- [ ] **Step 12: Commit**

```bash
git add docx-pdf-signer/package.json docx-pdf-signer/package-lock.json docx-pdf-signer/components.json docx-pdf-signer/lib/utils.ts docx-pdf-signer/tailwind.config.ts docx-pdf-signer/app/globals.css docx-pdf-signer/app/layout.tsx docx-pdf-signer/components/ui
git commit -m "feat: base do shadcn/ui (tokens, button, input, label, tabs, toaster)"
```

### Task 7: Helpers de API e de coordenadas

**Files:**
- Create: `lib/api-client.ts`
- Create: `lib/coords.ts`

- [ ] **Step 1: Criar `lib/api-client.ts`**

```ts
// Helpers de client. Lê a mensagem PT-BR de erro da API ({code, message}).
export interface ApiResult {
  blob?: Blob;
  error?: string;
}

export async function postForm(url: string, form: FormData): Promise<ApiResult> {
  try {
    const res = await fetch(url, { method: "POST", body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      return { error: body?.message ?? "Falha na operação. Tente novamente." };
    }
    return { blob: await res.blob() };
  } catch {
    return { error: "Não foi possível contatar o servidor." };
  }
}

export function download(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
```

- [ ] **Step 2: Criar `lib/coords.ts`**

```ts
// Conversão entre o retângulo desenhado no preview (px CSS, origem topo-esquerdo)
// e as coordenadas que o PDF/pyHanko espera (points, origem inferior-esquerdo).
export interface PdfRect {
  page: number; // 1-based
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * @param scale  px renderizados por point do PDF (escala do viewport do pdf.js)
 * @param pageHeightPts  altura da página em points (viewport.height / scale)
 */
export function pxRectToPdf(rect: PxRect, scale: number, pageHeightPts: number, page: number): PdfRect {
  const width = rect.width / scale;
  const height = rect.height / scale;
  const x = rect.left / scale;
  const y = pageHeightPts - rect.top / scale - height;
  return { page, x: round(x), y: round(y), width: round(width), height: round(height) };
}

export type Corner = "bottom-left" | "bottom-right" | "top-left" | "top-right";

/** Fallback quando o preview não carrega: posiciona por canto, em points. */
export function presetRect(
  corner: Corner,
  pageWidthPts: number,
  pageHeightPts: number,
  page: number,
  w = 200,
  h = 60,
  margin = 36,
): PdfRect {
  const left = corner.endsWith("left");
  const bottom = corner.startsWith("bottom");
  const x = left ? margin : pageWidthPts - w - margin;
  const y = bottom ? margin : pageHeightPts - h - margin;
  return { page, x: round(x), y: round(y), width: w, height: h };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add docx-pdf-signer/lib/api-client.ts docx-pdf-signer/lib/coords.ts
git commit -m "feat: helpers de API e conversão de coordenadas do carimbo"
```

### Task 8: Componente Dropzone

**Files:**
- Create: `components/dropzone.tsx`

- [ ] **Step 1: Criar `components/dropzone.tsx`**

```tsx
"use client";
import * as React from "react";
import { UploadCloud, FileCheck2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DropzoneProps {
  accept: string; // ex: ".docx" ou ".pdf"
  label: string;
  file: File | null;
  onFile: (file: File | null) => void;
}

export function Dropzone({ accept, label, file, onFile }: DropzoneProps) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const matches = (name: string) =>
    accept.split(",").some((ext) => name.toLowerCase().endsWith(ext.trim()));

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && matches(f.name)) onFile(f);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
        dragging ? "border-primary bg-secondary" : "border-input hover:bg-secondary/50",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <>
          <FileCheck2 className="h-7 w-7 text-primary" />
          <span className="text-sm font-medium">{file.name}</span>
          <span className="text-xs text-muted-foreground">Clique para trocar</span>
        </>
      ) : (
        <>
          <UploadCloud className="h-7 w-7 text-muted-foreground" />
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">Arraste aqui ou clique para selecionar ({accept})</span>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add docx-pdf-signer/components/dropzone.tsx
git commit -m "feat: componente Dropzone com drag-and-drop"
```

### Task 9: Componente de posicionamento do carimbo (pdf.js)

**Files:**
- Create: `components/stamp-positioner.tsx`

- [ ] **Step 1: Criar `components/stamp-positioner.tsx`**

```tsx
"use client";
import * as React from "react";
import * as pdfjsLib from "pdfjs-dist";
import { pxRectToPdf, presetRect, type PdfRect, type Corner } from "@/lib/coords";
import { Button } from "@/components/ui/button";

// Worker servido localmente (sem CDN externo).
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface Props {
  pdf: Blob; // PDF a posicionar o carimbo
  onChange: (rect: PdfRect) => void;
}

const RENDER_SCALE = 1.3;

export function StampPositioner({ pdf, onChange }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = React.useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [page, setPage] = React.useState(1);
  const [numPages, setNumPages] = React.useState(1);
  const [failed, setFailed] = React.useState(false);
  const [pageSizePts, setPageSizePts] = React.useState({ w: 595, h: 842 }); // A4 default
  // retângulo em px CSS relativo ao canvas
  const [box, setBox] = React.useState({ left: 40, top: 40, width: 200, height: 70 });
  const drag = React.useRef<{ mode: "move" | "resize"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);

  // carregar o documento uma vez
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const buf = await pdf.arrayBuffer();
        const loaded = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;
        setDoc(loaded);
        setNumPages(loaded.numPages);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  // renderizar a página atual
  React.useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await doc.getPage(page);
        if (cancelled) return;
        const viewport = p.getViewport({ scale: RENDER_SCALE });
        setPageSizePts({ w: viewport.width / RENDER_SCALE, h: viewport.height / RENDER_SCALE });
        const canvas = canvasRef.current!;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await p.render({ canvasContext: ctx, viewport }).promise;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, page]);

  // emitir o retângulo convertido sempre que box/page mudam
  React.useEffect(() => {
    if (failed) return;
    onChange(pxRectToPdf(box, RENDER_SCALE, pageSizePts.h, page));
  }, [box, page, pageSizePts.h, failed, onChange]);

  function onPointerDown(e: React.PointerEvent, mode: "move" | "resize") {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, ox: box.left, oy: box.top, ow: box.width, oh: box.height };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const canvas = canvasRef.current;
    const maxW = canvas?.width ?? 9999;
    const maxH = canvas?.height ?? 9999;
    if (d.mode === "move") {
      setBox((b) => ({
        ...b,
        left: clamp(d.ox + dx, 0, maxW - b.width),
        top: clamp(d.oy + dy, 0, maxH - b.height),
      }));
    } else {
      setBox((b) => ({
        ...b,
        width: clamp(d.ow + dx, 40, maxW - b.left),
        height: clamp(d.oh + dy, 24, maxH - b.top),
      }));
    }
  }
  function onPointerUp() {
    drag.current = null;
  }

  if (failed) {
    return <PresetFallback pageSize={pageSizePts} page={page} numPages={numPages} onPage={setPage} onChange={onChange} />;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Página</span>
        <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          −
        </Button>
        <span className="tabular-nums">{page} / {numPages}</span>
        <Button type="button" variant="outline" size="sm" disabled={page >= numPages} onClick={() => setPage((p) => p + 1)}>
          +
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">Arraste o selo; use o canto p/ redimensionar</span>
      </div>
      <div className="relative inline-block max-w-full overflow-auto rounded-md border" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <canvas ref={canvasRef} className="block" />
        <div
          onPointerDown={(e) => onPointerDown(e, "move")}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          className="absolute cursor-move rounded-sm border-2 border-primary bg-primary/15"
        >
          <div className="flex h-full items-center justify-center text-[10px] font-medium text-primary">ASSINATURA</div>
          <div
            onPointerDown={(e) => onPointerDown(e, "resize")}
            className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm border-2 border-primary bg-background"
          />
        </div>
      </div>
    </div>
  );
}

function PresetFallback({
  pageSize,
  page,
  numPages,
  onPage,
  onChange,
}: {
  pageSize: { w: number; h: number };
  page: number;
  numPages: number;
  onPage: (p: number) => void;
  onChange: (r: PdfRect) => void;
}) {
  const [corner, setCorner] = React.useState<Corner>("bottom-left");
  React.useEffect(() => {
    onChange(presetRect(corner, pageSize.w, pageSize.h, page));
  }, [corner, pageSize.w, pageSize.h, page, onChange]);

  const corners: { value: Corner; label: string }[] = [
    { value: "bottom-left", label: "Inferior esquerdo" },
    { value: "bottom-right", label: "Inferior direito" },
    { value: "top-left", label: "Superior esquerdo" },
    { value: "top-right", label: "Superior direito" },
  ];
  return (
    <div className="space-y-2 rounded-md border border-dashed p-3 text-sm">
      <p className="text-muted-foreground">Preview indisponível — posicione por canto:</p>
      <div className="flex flex-wrap gap-2">
        {corners.map((c) => (
          <Button key={c.value} type="button" variant={corner === c.value ? "default" : "outline"} size="sm" onClick={() => setCorner(c.value)}>
            {c.label}
          </Button>
        ))}
      </div>
      <label className="flex items-center gap-2">
        Página
        <input type="number" min={1} max={numPages} value={page} onChange={(e) => onPage(Number(e.target.value))} className="h-9 w-20 rounded-md border border-input px-2" />
      </label>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
```

- [ ] **Step 2: Verificar build (pdf.js + worker via URL)**

Run: `npx tsc --noEmit && npm run build`
Expected: build conclui sem erro (o worker do pdf.js é resolvido por `new URL(..., import.meta.url)`).

- [ ] **Step 3: Commit**

```bash
git add docx-pdf-signer/components/stamp-positioner.tsx
git commit -m "feat: posicionador de carimbo com preview pdf.js e fallback de presets"
```

### Task 10: Abas de fluxo (Converter, Assinar, Combinado)

**Files:**
- Create: `components/convert-tab.tsx`, `components/sign-tab.tsx`, `components/combined-tab.tsx`

- [ ] **Step 1: Criar `components/sign-fields.tsx` (campos compartilhados de certificado + carimbo)**

```tsx
"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dropzone } from "@/components/dropzone";
import { StampPositioner } from "@/components/stamp-positioner";
import type { PdfRect } from "@/lib/coords";

export interface SignConfig {
  pfx: File | null;
  password: string;
  tsaUrl: string;
  level: "B-B" | "B-T" | "B-LT" | "B-LTA";
  reason: string;
  location: string;
  visible: boolean;
  rect: PdfRect | null;
}

export const emptySignConfig: SignConfig = {
  pfx: null,
  password: "",
  tsaUrl: "",
  level: "B-B",
  reason: "",
  location: "",
  visible: false,
  rect: null,
};

export function SignFields({
  cfg,
  setCfg,
  previewPdf,
}: {
  cfg: SignConfig;
  setCfg: React.Dispatch<React.SetStateAction<SignConfig>>;
  previewPdf: Blob | null;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Certificado .pfx / .p12</Label>
        <Dropzone accept=".pfx,.p12" label="Certificado A1" file={cfg.pfx} onFile={(f) => setCfg((c) => ({ ...c, pfx: f }))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pw">Senha do certificado</Label>
          <Input id="pw" type="password" value={cfg.password} onChange={(e) => setCfg((c) => ({ ...c, password: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="level">Nível PAdES</Label>
          <select
            id="level"
            value={cfg.level}
            onChange={(e) => setCfg((c) => ({ ...c, level: e.target.value as SignConfig["level"] }))}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="B-B">B-B (sem carimbo de tempo)</option>
            <option value="B-T">B-T (com carimbo de tempo)</option>
            <option value="B-LT">B-LT (long-term)</option>
            <option value="B-LTA">B-LTA (long-term + archive)</option>
          </select>
        </div>
      </div>
      {cfg.level !== "B-B" && (
        <div className="space-y-1.5">
          <Label htmlFor="tsa">URL da TSA (carimbo de tempo) — obrigatória</Label>
          <Input id="tsa" type="url" placeholder="https://..." value={cfg.tsaUrl} onChange={(e) => setCfg((c) => ({ ...c, tsaUrl: e.target.value }))} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="reason">Motivo (opcional)</Label>
          <Input id="reason" value={cfg.reason} onChange={(e) => setCfg((c) => ({ ...c, reason: e.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="loc">Local (opcional)</Label>
          <Input id="loc" value={cfg.location} onChange={(e) => setCfg((c) => ({ ...c, location: e.target.value }))} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cfg.visible} onChange={(e) => setCfg((c) => ({ ...c, visible: e.target.checked }))} />
        Carimbo visível no documento
      </label>
      {cfg.visible && previewPdf && (
        <StampPositioner pdf={previewPdf} onChange={(rect) => setCfg((c) => ({ ...c, rect }))} />
      )}
      {cfg.visible && !previewPdf && (
        <p className="text-sm text-muted-foreground">O preview aparece após selecionar/gerar o PDF.</p>
      )}
    </div>
  );
}

/** Monta o FormData de assinatura a partir do PDF e da config. */
export function buildSignForm(pdf: Blob, cfg: SignConfig): FormData {
  const f = new FormData();
  f.append("pdf", pdf, "documento.pdf");
  f.append("pfx", cfg.pfx!);
  f.append("password", cfg.password);
  f.append("level", cfg.level);
  if (cfg.tsaUrl) f.append("tsa_url", cfg.tsaUrl);
  if (cfg.reason) f.append("reason", cfg.reason);
  if (cfg.location) f.append("location", cfg.location);
  if (cfg.visible && cfg.rect) {
    f.append("visible", "true");
    f.append("page", String(cfg.rect.page));
    f.append("x", String(cfg.rect.x));
    f.append("y", String(cfg.rect.y));
    f.append("width", String(cfg.rect.width));
    f.append("height", String(cfg.rect.height));
  }
  return f;
}

/** Valida a config; retorna mensagem PT-BR de erro ou null. */
export function validateSignConfig(cfg: SignConfig): string | null {
  if (!cfg.pfx) return "Selecione o certificado .pfx.";
  if (!cfg.password) return "Informe a senha do certificado.";
  if (cfg.level !== "B-B" && !cfg.tsaUrl) return "Informe a URL da TSA para o nível escolhido.";
  if (cfg.visible && !cfg.rect) return "Posicione o carimbo visível no documento.";
  return null;
}
```

- [ ] **Step 2: Criar `components/convert-tab.tsx`**

```tsx
"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/dropzone";
import { postForm, download } from "@/lib/api-client";

export function ConvertTab() {
  const [docx, setDocx] = React.useState<File | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function run() {
    if (!docx) return toast.error("Selecione um arquivo .docx.");
    setLoading(true);
    const f = new FormData();
    f.append("file", docx);
    const r = await postForm("/api/convert", f);
    setLoading(false);
    if (r.error) return toast.error(r.error);
    download(r.blob!, docx.name.replace(/\.docx$/i, "") + ".pdf");
    toast.success("PDF gerado.");
  }

  return (
    <div className="space-y-4">
      <Dropzone accept=".docx" label="Documento .docx" file={docx} onFile={setDocx} />
      <Button className="w-full" disabled={loading} onClick={run}>
        {loading ? "Convertendo..." : "Converter para PDF"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Criar `components/sign-tab.tsx`**

```tsx
"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/dropzone";
import { postForm, download } from "@/lib/api-client";
import { SignFields, emptySignConfig, buildSignForm, validateSignConfig, type SignConfig } from "@/components/sign-fields";

export function SignTab() {
  const [pdf, setPdf] = React.useState<File | null>(null);
  const [cfg, setCfg] = React.useState<SignConfig>(emptySignConfig);
  const [loading, setLoading] = React.useState(false);

  async function run() {
    if (!pdf) return toast.error("Selecione o PDF a assinar.");
    const err = validateSignConfig(cfg);
    if (err) return toast.error(err);
    setLoading(true);
    const r = await postForm("/api/sign", buildSignForm(pdf, cfg));
    setLoading(false);
    if (r.error) return toast.error(r.error);
    download(r.blob!, pdf.name.replace(/\.pdf$/i, "") + "-assinado.pdf");
    toast.success("PDF assinado.");
  }

  return (
    <div className="space-y-4">
      <Dropzone accept=".pdf" label="PDF a assinar" file={pdf} onFile={setPdf} />
      <SignFields cfg={cfg} setCfg={setCfg} previewPdf={pdf} />
      <Button className="w-full" disabled={loading} onClick={run}>
        {loading ? "Assinando..." : "Assinar PDF"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Criar `components/combined-tab.tsx`** (converte primeiro quando há carimbo visível)

```tsx
"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dropzone } from "@/components/dropzone";
import { postForm, download } from "@/lib/api-client";
import { SignFields, emptySignConfig, buildSignForm, validateSignConfig, type SignConfig } from "@/components/sign-fields";

export function CombinedTab() {
  const [docx, setDocx] = React.useState<File | null>(null);
  const [cfg, setCfg] = React.useState<SignConfig>(emptySignConfig);
  const [converted, setConverted] = React.useState<Blob | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Trocar o .docx invalida qualquer conversão anterior.
  React.useEffect(() => {
    setConverted(null);
  }, [docx]);

  async function convert(): Promise<Blob | null> {
    const f = new FormData();
    f.append("file", docx!);
    const r = await postForm("/api/convert", f);
    if (r.error) {
      toast.error(r.error);
      return null;
    }
    return r.blob!;
  }

  // Passo intermediário: para carimbo visível, precisamos do PDF antes de posicionar.
  async function prepare() {
    if (!docx) return toast.error("Selecione o arquivo .docx.");
    setLoading(true);
    const pdf = await convert();
    setLoading(false);
    if (pdf) {
      setConverted(pdf);
      toast.success("Convertido. Posicione o carimbo e finalize.");
    }
  }

  async function run() {
    if (!docx) return toast.error("Selecione o arquivo .docx.");
    const err = validateSignConfig(cfg);
    if (err) return toast.error(err);
    setLoading(true);
    const pdf = converted ?? (await convert());
    if (!pdf) return setLoading(false);
    const r = await postForm("/api/sign", buildSignForm(pdf, cfg));
    setLoading(false);
    if (r.error) return toast.error(r.error);
    download(r.blob!, docx.name.replace(/\.docx$/i, "") + "-assinado.pdf");
    toast.success("PDF convertido e assinado.");
  }

  const needsPrepare = cfg.visible && !converted;

  return (
    <div className="space-y-4">
      <Dropzone accept=".docx" label="Documento .docx" file={docx} onFile={setDocx} />
      <SignFields cfg={cfg} setCfg={setCfg} previewPdf={converted} />
      {needsPrepare ? (
        <Button className="w-full" variant="secondary" disabled={loading} onClick={prepare}>
          {loading ? "Convertendo..." : "Converter e mostrar preview p/ posicionar carimbo"}
        </Button>
      ) : (
        <Button className="w-full" disabled={loading} onClick={run}>
          {loading ? "Processando..." : "Converter + Assinar"}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add docx-pdf-signer/components/sign-fields.tsx docx-pdf-signer/components/convert-tab.tsx docx-pdf-signer/components/sign-tab.tsx docx-pdf-signer/components/combined-tab.tsx
git commit -m "feat: abas de fluxo (converter, assinar, combinado) com campos de assinatura"
```

### Task 11: Página principal com abas

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Reescrever `app/page.tsx`**

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConvertTab } from "@/components/convert-tab";
import { SignTab } from "@/components/sign-tab";
import { CombinedTab } from "@/components/combined-tab";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">DocSign</h1>
        <p className="text-sm text-muted-foreground">
          Converte DOCX em PDF com fidelidade e assina com certificado A1 (ICP-Brasil).
        </p>
      </header>

      <Tabs defaultValue="combined">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="convert">Converter</TabsTrigger>
          <TabsTrigger value="sign">Assinar</TabsTrigger>
          <TabsTrigger value="combined">Converter + Assinar</TabsTrigger>
        </TabsList>

        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <TabsContent value="convert"><ConvertTab /></TabsContent>
          <TabsContent value="sign"><SignTab /></TabsContent>
          <TabsContent value="combined"><CombinedTab /></TabsContent>
        </div>
      </Tabs>
    </main>
  );
}
```

- [ ] **Step 2: Build + verificação manual end-to-end**

Run:
```bash
npx tsc --noEmit && npm run build
docker compose up --build -d
```
Abrir `http://localhost:3001` e validar:
- **Converter:** arrastar um `.docx` → baixa o PDF; toast verde.
- **Assinar:** subir um PDF + `test-cert.pfx` (senha do `gen-test-cert.sh`), nível B-B, marcar "carimbo visível" → preview renderiza, arrastar o selo, **Assinar** → baixa `-assinado.pdf` com o selo na posição.
- **Converter + Assinar:** com carimbo visível, o botão vira "Converter e mostrar preview"; após converter, o preview aparece e o botão vira "Converter + Assinar".
- **Erros PT-BR:** senha errada → toast "Não foi possível abrir o certificado..."; nível B-T sem TSA → toast "Informe a URL da TSA...".

- [ ] **Step 3: Commit**

```bash
git add docx-pdf-signer/app/page.tsx
git commit -m "feat: página com abas (converter/assinar/combinado) usando shadcn/ui"
```

---

## Atualização final do CLAUDE.md

### Task 12: Refletir o novo estado no CLAUDE.md

**Files:**
- Modify: `../CLAUDE.md` (§0 — lacunas conhecidas)

- [ ] **Step 1: Atualizar a lista de "Lacunas conhecidas" no §0**

Remover/ajustar os itens agora resolvidos: a UI deixou de ser MVP cru (shadcn + drag-and-drop + preview); o carimbo visível, `contact`, `reason`/`location` e `B-LTA` passaram a ser encaminhados; a fila de concorrência passou a existir. Manter como lacuna apenas: ausência de testes automatizados e fila global multi-réplica. Marcar as Fases 1–4 deste plano como concluídas.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: atualizar §0 do CLAUDE.md com o estado pós production-ready pass"
```

---

## Self-review (cobertura do spec)

- **Fase 1 (git):** Task 1 — init, `.gitignore` com segredos, commit. ✓
- **Fase 2 (fila):** Tasks 2–3 — semáforo FIFO+timeout, `withConversionSlot`, envs, erro BUSY 503, verificação de serialização. Trade-off por-processo documentado no spec. ✓
- **Fase 3 (assinatura):** Tasks 4–5 — `B-LTA` no tipo, repasse de `contact`/coords/level, validação, regra nível×TSA, conversão de coords no client (`lib/coords.ts`). ✓
- **Fase 4 (UI):** Tasks 6–11 — shadcn (tokens+componentes), Dropzone, `StampPositioner` (pdf.js + fallback presets), abas, fluxo combinado converte-primeiro, erros PT-BR via toast. ✓
- **Tipos consistentes:** `SignConfig`/`PdfRect`/`buildSignForm`/`validateSignConfig` usados igualmente em `sign-tab` e `combined-tab`; `pxRectToPdf`/`presetRect` batem com o uso em `stamp-positioner`. ✓
- **Sem placeholders:** todos os passos de código têm código completo. ✓
- **YAGNI:** fila global, cofre de cert e testes automatizados ficaram fora (registrado no spec). ✓
