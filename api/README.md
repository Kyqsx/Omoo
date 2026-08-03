# Backend — Chat de Vídeo Anônimo

## Estrutura do projeto

```
omegle-backend/
├── server.js                        # Ponto de entrada
├── package.json
├── .env.example                     # Modelo de variáveis de ambiente
└── src/
    ├── config/
    │   ├── db.js                    # Conexão PostgreSQL
    │   ├── redis.js                 # Conexão Redis
    │   └── stripe.js                # Cliente Stripe
    ├── controllers/
    │   └── stripeController.js      # Checkout + Webhook
    ├── routes/
    │   └── stripeRoutes.js          # Rotas HTTP de pagamento
    ├── sockets/
    │   └── matchmaking.js           # Lógica de fila + WebRTC signaling
    └── db/
        └── schema.sql               # Tabela "users"
```

## Pré-requisitos

Instale antes de começar:
- **Node.js** (versão 18 ou superior) — https://nodejs.org
- **PostgreSQL** — pode ser local ou um serviço gratuito como Supabase/Railway
- **Redis** — local (`redis-server`) ou um serviço gratuito como Upstash
- Uma conta no **Stripe** (modo de teste é suficiente para começar) — https://dashboard.stripe.com

## Passo 1 — Instalar dependências

```bash
cd omegle-backend
npm install
```

Isso vai ler o `package.json` e instalar: express, socket.io, redis, pg, stripe, dotenv, cors.

## Passo 2 — Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Abra o `.env` e preencha:
- `DATABASE_URL`: string de conexão do seu PostgreSQL
- `REDIS_URL`: string de conexão do seu Redis (padrão local: `redis://localhost:6379`)
- `STRIPE_SECRET_KEY`: em https://dashboard.stripe.com/test/apikeys
- `STRIPE_PRICE_ID`: crie um produto recorrente mensal em
  Dashboard Stripe → Product Catalog → Add Product → e copie o "Price ID" (começa com `price_`)
- `STRIPE_WEBHOOK_SECRET`: veja o Passo 5 abaixo (é gerado ao testar o webhook)

## Passo 3 — Criar a tabela no PostgreSQL

Com o Postgres rodando, execute:

```bash
psql -U seu_usuario -d omegle_db -f src/db/schema.sql
```

(Ou rode o conteúdo de `src/db/schema.sql` manualmente em qualquer cliente
gráfico, como TablePlus, DBeaver ou o painel do Supabase.)

## Passo 4 — Subir o Redis (se estiver rodando local)

```bash
redis-server
```

Se preferir não instalar nada localmente, use um Redis gratuito na nuvem
(ex: Upstash) e coloque a URL fornecida em `REDIS_URL` no `.env`.

## Passo 5 — Testar o Webhook do Stripe localmente

O Stripe precisa enviar eventos para o seu `/webhook/stripe`, mas sua
máquina local não tem um endereço público. Para testar localmente, use a
**Stripe CLI**:

```bash
# Instale a CLI: https://stripe.com/docs/stripe-cli
stripe login
stripe listen --forward-to localhost:3000/webhook/stripe
```

Esse comando vai imprimir algo como:
```
Ready! Your webhook signing secret is whsec_XXXXXXXXXXXX
```
Copie esse valor para `STRIPE_WEBHOOK_SECRET` no seu `.env`.

Deixe esse comando rodando em um terminal separado enquanto testa.

## Passo 6 — Rodar o servidor

```bash
npm start
```

Ou, se instalou o `nodemon` (reinicia sozinho a cada alteração de código):
```bash
npm run dev
```

Se tudo estiver certo, você verá:
```
[Redis] Conectado com sucesso.
🚀 Servidor rodando em http://localhost:3000
```

Teste abrindo `http://localhost:3000` no navegador — deve responder um JSON
`{"status":"ok", ...}`.

## Passo 7 — Testar o fluxo de pagamento

1. Crie uma sessão de checkout:
   ```bash
   curl -X POST http://localhost:3000/api/create-checkout-session \
     -H "Content-Type: application/json" \
     -d '{"userId": 1, "email": "teste@exemplo.com"}'
   ```
2. Abra a `checkoutUrl` retornada no navegador e finalize o pagamento
   usando um cartão de teste do Stripe, ex: `4242 4242 4242 4242`,
   qualquer data futura e qualquer CVC.
3. No terminal onde está rodando `stripe listen`, você verá o evento
   `invoice.payment_succeeded` sendo capturado e encaminhado.
4. No terminal do `npm start`, você verá o log confirmando que o usuário
   virou Premium no banco.

**Atenção:** para o webhook conseguir encontrar o usuário certo no banco
(`WHERE stripe_customer_id = ...`), você precisa, no seu fluxo real, salvar
o `stripe_customer_id` do usuário assim que ele é criado no Stripe (por
exemplo, logo após a criação da sessão de checkout, usando
`session.customer`, ou criando o customer manualmente antes com
`stripe.customers.create()` e salvando o ID no Postgres). Deixei essa parte
como próximo passo para você adaptar conforme o seu fluxo de cadastro de
usuários (login, etc), já que isso não foi detalhado no requisito original.

## Passo 8 — Testar o matchmaking via Socket.io

Você pode simular dois clientes rapidamente com Node, criando um arquivo de
teste temporário `test-client.js` na raiz do projeto:

```js
const { io } = require('socket.io-client'); // npm install socket.io-client --save-dev

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Conectado:', socket.id);
  socket.emit('find_match', { filters: {} }); // usuário Free, sem filtro
});

socket.on('match_found', (data) => {
  console.log('Match encontrado!', data);
});
```

Abra dois terminais e rode `node test-client.js` em cada um. O segundo
cliente a se conectar deve receber o evento `match_found` quase
instantaneamente, junto com o primeiro.

Para testar filas com filtro (usuário Premium), primeiro marque um usuário
como `is_premium = true` direto no banco, e mande o `userId` dele no
`find_match`, junto com `filters: { country: "brasil" }`.

## Deploy em produção: Railway (backend) + Vercel (frontend) + Supabase (banco)

Por que essa combinação faz sentido aqui: o Socket.io precisa de uma conexão
persistente (WebSocket) com o servidor, algo que a Vercel **não** suporta bem
para backend (ela é otimizada para funções serverless de vida curta). Por
isso o backend vai para a **Railway** (processo Node rodando o tempo todo),
o frontend estático/SPA vai para a **Vercel**, e o Postgres gerenciado fica
no **Supabase**.

### A) Supabase (Postgres)

1. Crie um projeto em https://supabase.com.
2. Vá em **Project Settings → Database → Connection string** e copie a
   opção **Connection pooling** (porta `6543`) — ela lida melhor com várias
   conexões simultâneas, o que é comum em apps na nuvem.
3. Cole essa string em `DATABASE_URL` (tanto no `.env` local quanto depois
   nas variáveis da Railway).
4. Rode o `src/db/schema.sql` direto no **SQL Editor** do painel do
   Supabase (cole o conteúdo do arquivo e clique em "Run") — não precisa
   nem instalar `psql` localmente.

### B) Railway (backend)

1. Suba este projeto para um repositório no GitHub.
2. Em https://railway.app, crie um novo projeto → **Deploy from GitHub repo**
   e selecione o repositório.
3. No mesmo projeto Railway, clique em **+ New → Database → Add Redis**.
   Isso cria um serviço Redis dentro do projeto automaticamente.
4. No serviço do **backend** (não no Redis), vá em **Variables** e adicione:
   - `DATABASE_URL` → a connection string do Supabase (passo A)
   - `DATABASE_SSL` → `true`
   - `REDIS_URL` → clique em "Add Reference" e aponte para a variável
     `REDIS_URL` do serviço Redis (Railway faz essa ligação automaticamente
     entre serviços do mesmo projeto — não precisa copiar/colar manualmente)
   - `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`
   - `FRONTEND_URL` → a URL que a Vercel vai te dar (passo C), ex:
     `https://seu-app.vercel.app`
   - `CHECKOUT_SUCCESS_URL` / `CHECKOUT_CANCEL_URL` → páginas do seu
     frontend na Vercel
   - `PORT` — não precisa definir, a Railway injeta automaticamente
5. A Railway detecta o `package.json` e usa `npm start` sozinha. Não
   precisa de configuração extra de build.
6. Após o deploy, a Railway te dá uma URL pública, ex:
   `https://omegle-backend-production.up.railway.app`.
   Se quiser um domínio bonito, ative em **Settings → Networking →
   Generate Domain** (ou conecte um domínio próprio).

### C) Vercel (frontend)

1. Suba o código do frontend (ainda não construído nesta entrega) para o
   GitHub e importe o repositório na Vercel.
2. Nas **Environment Variables** do projeto na Vercel, aponte para a URL
   pública do backend gerada pela Railway, ex:
   `VITE_BACKEND_URL=https://omegle-backend-production.up.railway.app`
   (o nome exato da variável depende do framework do frontend —
   Vite usa prefixo `VITE_`, Next.js usa `NEXT_PUBLIC_`, etc).
3. No código do frontend, o Socket.io se conecta assim:
   ```js
   import { io } from 'socket.io-client';
   const socket = io(import.meta.env.VITE_BACKEND_URL); // wss:// automático em produção
   ```
4. Depois do primeiro deploy da Vercel, volte na Railway e atualize a
   variável `FRONTEND_URL` do backend com a URL real da Vercel (e faça
   redeploy do backend), para o CORS liberar corretamente.

### D) Atualizando o Webhook do Stripe para produção

O `stripe listen` (Passo 5 do modo local) é só para desenvolvimento. Em
produção:

1. No Dashboard do Stripe → **Developers → Webhooks → Add endpoint**.
2. URL do endpoint: `https://SEU-BACKEND.up.railway.app/webhook/stripe`
3. Evento a escutar: `invoice.payment_succeeded`.
4. O Stripe vai te dar um novo **Signing secret** (`whsec_...`) — cole em
   `STRIPE_WEBHOOK_SECRET` nas variáveis da Railway e faça redeploy.

### Checklist rápido de deploy

- [ ] Tabela `users` criada no Supabase
- [ ] Redis adicionado ao projeto na Railway
- [ ] Todas as variáveis de ambiente preenchidas na Railway (sem `localhost`!)
- [ ] Domínio público gerado na Railway
- [ ] `FRONTEND_URL` na Railway = domínio real da Vercel
- [ ] Variável de URL do backend configurada na Vercel = domínio real da Railway
- [ ] Webhook do Stripe apontando para o domínio da Railway (não mais `stripe listen`)

## Próximos passos recomendados (fora do escopo desta entrega inicial)

- **Autenticação real** dos usuários (JWT/sessão) para saber quem é quem
  antes de entrar na fila — hoje o `userId` é confiado "no olho".
- **Moderação de conteúdo**: em um produto de vídeo-chat anônimo, é
  fortemente recomendável (e em muitas jurisdições, exigido) ter
  verificação de idade, denúncia de usuários e algum tipo de moderação
  automática/humana para coibir abuso.
- **Rate limiting** nas rotas HTTP e nos eventos de socket, para evitar
  spam de `find_match`.
- **Servidor TURN** (ex: coturn ou um serviço como Twilio/Metered) além do
  STUN, porque nem toda conexão P2P consegue se conectar direto — muitas
  redes corporativas/móveis bloqueiam.
- Persistir métricas de fila (tempo médio de espera, etc.) se quiser depois
  otimizar a experiência.
