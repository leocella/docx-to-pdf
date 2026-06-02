# Instalação do DocSign em uma máquina Linux

Guia passo a passo para subir o DocSign (conversão DOCX→PDF + assinatura digital A1)
do zero em um notebook/servidor Linux. Pensado para **Ubuntu/Debian**; há notas para
outras distros onde necessário.

> Resumo do que vamos fazer: instalar Docker + Git → clonar o repositório →
> subir os 3 serviços com um comando → validar com o smoke test → usar pela web.

---

## 0. Pré-requisitos (o que precisa estar na máquina)

| Ferramenta | Para quê | Já vem no Linux? |
|---|---|---|
| **Docker Engine + Docker Compose v2** | rodar os 3 serviços | ❌ instalar |
| **git** | baixar o código | geralmente sim |
| **curl** | smoke test / instalar Docker | geralmente sim |
| **openssl** | gerar o certificado de teste | geralmente sim |
| **zip** | gerar o .docx de teste | às vezes falta |

Hardware recomendado: **2 vCPU / 4 GB RAM** ou mais (o LibreOffice, dentro do
Gotenberg, é o componente mais pesado). Disco: ~2 GB para as imagens Docker.

---

## 1. Instalar o Docker

A forma mais simples e que funciona na maioria das distros é o script oficial:

```bash
curl -fsSL https://get.docker.com | sh
```

Depois, para usar o Docker **sem `sudo`** (recomendado), adicione seu usuário ao grupo
`docker` e reabra a sessão:

```bash
sudo usermod -aG docker "$USER"
# saia e entre de novo no terminal (logout/login) OU rode:
newgrp docker
```

Confirme que está tudo certo (as duas linhas têm que responder com versões):

```bash
docker --version
docker compose version
```

> ⚠️ É `docker compose` (com espaço, plugin v2), **não** `docker-compose` (hífen, antigo).
> Se só tiver o antigo, instale o plugin: `sudo apt install docker-compose-plugin`.

> **Fedora/RHEL:** o script `get.docker.com` também funciona; depois
> `sudo systemctl enable --now docker`.
> **Arch:** `sudo pacman -S docker docker-compose && sudo systemctl enable --now docker`.

---

## 2. Instalar as ferramentas de apoio

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y git curl openssl zip
```

(Fedora: `sudo dnf install -y git curl openssl zip` · Arch: `sudo pacman -S git curl openssl zip`)

---

## 3. Configurar o acesso ao GitHub (repositório privado)

O repositório é **privado**, então a máquina precisa de credencial para cloná-lo.
O jeito mais limpo é por **chave SSH**.

### 3.1 Gerar uma chave SSH na máquina (se ainda não tiver)

```bash
ssh-keygen -t ed25519 -C "rafael@docsign" -f ~/.ssh/id_ed25519
# pode dar Enter em tudo (sem passphrase, para simplificar)
```

### 3.2 Registrar a chave pública no GitHub

```bash
cat ~/.ssh/id_ed25519.pub
```

Copie a saída inteira (começa com `ssh-ed25519 ...`) e cole em:
**GitHub → Settings → SSH and GPG keys → New SSH key** → cole → **Add SSH key**.

### 3.3 Testar

```bash
ssh -T git@github.com
```

Deve responder **`Hi <usuario>! You've successfully authenticated...`**.
Se aparecer `Permission denied (publickey)`, revise os passos 3.1–3.2.

> Identidade do Git (para commits, caso vá versionar algo):
> ```bash
> git config --global user.name "Seu Nome"
> git config --global user.email "seu@email.com"
> ```

---

## 4. Clonar o repositório

```bash
cd ~
git clone git@github.com:leocella/docx-to-pdf.git
cd docx-to-pdf/docx-pdf-signer
```

> O código vive na subpasta **`docx-pdf-signer/`** — todos os comandos abaixo
> rodam **de dentro dela**.

---

## 5. Configurar variáveis de ambiente (opcional)

```bash
cp .env.example .env
```

O padrão já funciona. Edite o `.env` só se precisar:

| Variável | Padrão | Quando mexer |
|---|---|---|
| `MAX_UPLOAD_MB` | `25` | limite de tamanho de upload |
| `MAX_CONCURRENT_CONVERSIONS` | `2` | quantas conversões simultâneas (proteção do LibreOffice) |
| `QUEUE_TIMEOUT_MS` | `30000` | quanto a requisição espera na fila antes de devolver "ocupado" |
| `DEFAULT_TSA_URL` | *(vazio)* | URL de uma TSA (carimbo de tempo) para assinar em B-T/B-LT |

> Sem `DEFAULT_TSA_URL`, a assinatura padrão é **B-B** (sem carimbo de tempo). Para
> níveis B-T/B-LT/B-LTA é obrigatório informar uma TSA (no `.env` ou no formulário).

---

## 6. Subir a solução

```bash
docker compose up --build -d
```

A **primeira vez demora alguns minutos** (baixa a imagem do LibreOffice e compila o
app). Acompanhe a saúde dos serviços:

```bash
docker compose ps
```

Espere os 3 ficarem **`healthy`** (o `gotenberg` é o mais lento a subir). Para ver os
logs em tempo real:

```bash
docker compose logs -f
# (Ctrl+C para sair do acompanhamento — não derruba os serviços)
```

Cheque a saúde pela API:

```bash
curl http://localhost:3001/api/health
# esperado: {"status":"ok","services":{"gotenberg":true,"signer":true}}
```

---

## 7. Validar tudo com o smoke test

Roda um teste automático de ponta a ponta (sobe nada extra — usa os serviços já no ar):

```bash
bash scripts/smoke-test.sh
```

Ele gera um certificado e um `.docx` de teste e exercita conversão, assinatura
(invisível e com carimbo) e os erros tratados. No fim deve mostrar **`PASSOU: 10  FALHOU: 0`**.
Os PDFs de resultado ficam em **`smoke-out/`** — abra o `assinado-carimbo.pdf` para
ver o selo de assinatura.

> Se algo falhar, o próprio script aponta; para investigar:
> `docker compose logs signer 2>&1 | tail -30`.

---

## 8. Usar pela web

Abra no navegador:

- **No próprio notebook:** <http://localhost:3001>
- **De outra máquina na mesma rede:** `http://IP-DO-NOTEBOOK:3001`
  (descubra o IP com `ip addr` ou `hostname -I`). Se não abrir de fora, libere a porta:
  ```bash
  sudo ufw allow 3001/tcp   # se usar o firewall ufw
  ```

Na interface há três abas:

1. **Converter** — arraste um `.docx`, baixe o PDF.
2. **Assinar** — envie um PDF + o certificado **A1** (`.pfx`/`.p12`) + senha; opcionalmente
   ligue o **carimbo visível** e arraste o selo sobre o documento.
3. **Converter + Assinar** — faz os dois em sequência.

> **Validação definitiva:** assine com o **A1 real** e abra o PDF no **Adobe Reader** —
> o painel de assinaturas deve exibir a assinatura ICP-Brasil com o nome do titular.

---

## 9. Operação do dia a dia

```bash
# parar os serviços (libera as portas; dados efêmeros somem)
docker compose down

# subir de novo (rápido, já está tudo em cache)
docker compose up -d

# ver logs de um serviço específico
docker compose logs app
docker compose logs signer
docker compose logs gotenberg

# reiniciar um serviço
docker compose restart app
```

### Atualizar para uma versão nova do código

```bash
cd ~/docx-to-pdf
git pull
cd docx-pdf-signer
docker compose up --build -d
```

---

## 10. Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| `/api/health` não fica `ok` em 180s | LibreOffice ainda subindo ou pouca RAM | `docker compose logs gotenberg`; garanta ≥ 4 GB RAM |
| Porta `3001` em uso | outro processo ocupando | `sudo lsof -i:3001`; ou mude a porta publicada no `docker-compose.yml` |
| `permission denied` no Docker | usuário fora do grupo `docker` | refaça o passo 1 (`usermod -aG docker` + relogar) |
| `git clone` pede senha | repositório privado sem credencial | configure a chave SSH (passo 3) |
| Assinatura falha com cert real | certificado expirado/sem `non-repudiation` | confira a validade do A1 e a senha |
| Conversão devolve "ocupado" (503) | fila cheia | aumente `MAX_CONCURRENT_CONVERSIONS` no `.env` (cuidado com a RAM) |

---

## 11. Notas de segurança

- O certificado `.pfx` e a senha **nunca são gravados em disco persistente** nem em log:
  vivem em memória/tmpfs durante a requisição e são destruídos em seguida.
- Apenas o serviço **`app`** (porta 3001) deve ficar exposto. O `gotenberg` e o `signer`
  ficam só na rede interna do Docker — **não publique as portas deles** na internet.
- Para expor publicamente com domínio + HTTPS, coloque um proxy reverso (ex.: Traefik
  ou Nginx) na frente do `app`. Peça ajuda para configurar essa parte.

---

Dúvidas ou erro em algum passo? Anote a mensagem exata e a saída de
`docker compose logs` — com isso fica fácil destravar.
