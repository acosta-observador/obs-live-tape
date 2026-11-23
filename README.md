# OBS Live Tape

Transcrição em direto para jornalistas do Observador (comissões de inquérito, audições parlamentares, etc.), com o Scribe v2 Realtime da ElevenLabs.

> A transcrição é um **rascunho de trabalho**. A interface mostra sempre o aviso "Transcrição automática. Confirmar citações contra o áudio."

## Estado do projeto

| Etapa | Conteúdo | Estado |
|---|---|---|
| 1 | Base, login por palavra-passe, rota do token, deploy | feito |
| 2 | Cliente realtime, ecrã de transcrição, nível do microfone, timestamps, `/diagnostico` | por fazer |
| 3 | Gravação local de áudio e sessão no IndexedDB | por fazer |
| 4 | Reconexão automática | por fazer |
| 5 | Marcadores, pesquisa, alertas, vocabulário | por fazer |
| 6 | Exportação .txt / .srt / .docx | por fazer |

## Como funciona (arquitetura)

- Next.js 16 (App Router) + TypeScript + Tailwind, como Web Service no Render.
- O browser **liga-se diretamente à ElevenLabs**; o áudio não passa pelo nosso servidor.
- A chave `ELEVENLABS_API_KEY` **só existe no servidor**. A rota `POST /api/scribe-token` pede à ElevenLabs um token de uso único (15 min para ser usado) e devolve apenas esse token.
- Todo o acesso é protegido por uma palavra-passe partilhada. O `proxy.ts` (o antigo "middleware" do Next) exige um cookie de sessão httpOnly assinado (HMAC) em todas as páginas e APIs, exceto `/login` e `/api/login`. A rota do token volta a verificar a sessão.
- O servidor **não regista conteúdo de transcrições nem áudio**. Só regista o código HTTP de falhas ao pedir tokens.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `ELEVENLABS_API_KEY` | sim | Chave da ElevenLabs. Cria uma só para este projeto, com permissões mínimas e limite de créditos. |
| `APP_ACCESS_PASSWORD` | sim | Palavra-passe partilhada. Mudá-la termina todas as sessões abertas. |
| `SESSION_SECRET` | não | Segredo extra para assinar os cookies. |
| `SCRIBE_MAX_SESSION_SECONDS` | não | Fecha a sessão realtime ao fim de N segundos. |

Há um modelo em `.env.example`.

## Correr localmente

Requer Node.js 20.9 ou superior (testado com 22).

```bash
npm install
cp .env.example .env.local   # preenche ELEVENLABS_API_KEY e APP_ACCESS_PASSWORD
npm run dev
```

Abre http://localhost:3000, entra com a palavra-passe e carrega em **Testar token**. Deve aparecer "Token recebido".

Para testar a versão de produção: `npm run build && npm start`.

## Deploy no Render

1. Faz push deste projeto para um repositório (GitHub/GitLab).
2. No Render: **New > Blueprint** e escolhe o repositório. O `render.yaml` cria o Web Service `obs-live-tape` (Node 22, região Frankfurt).
3. Quando o Render pedir, preenche `ELEVENLABS_API_KEY` e `APP_ACCESS_PASSWORD`. O `SESSION_SECRET` é gerado automaticamente.
4. Depois do primeiro deploy, abre o URL `*.onrender.com`, entra e carrega em **Testar token**.

Notas:
- O plano `starter` evita que o serviço adormeça (o plano gratuito adormece e o primeiro pedido demora).
- O microfone no browser **só funciona em HTTPS** (ou em `localhost`). O Render já serve HTTPS.
- O limite de tentativas de login está em memória, adequado a uma única instância. Se escalares para várias, move-o para um armazenamento partilhado.

## Estrutura

```
proxy.ts                      proteção por sessão (páginas e APIs)
lib/auth.ts                   cookie assinado e verificação da palavra-passe
app/login/page.tsx            ecrã de entrada
app/page.tsx                  ecrã principal (provisório na etapa 1)
app/api/login|logout          sessão
app/api/scribe-token          token de curta duração para a ElevenLabs
render.yaml                   blueprint do Render
```

## Notas sobre a API da ElevenLabs (confirmadas na documentação oficial)

- Token: `POST /v1/single-use-token/realtime_scribe`; opcional `max_session_duration_seconds`.
- WebSocket: `wss://api.elevenlabs.io/v1/speech-to-text/realtime`, modelos `scribe_v2_realtime` (defeito) e `scribe_v3_live`.
- Áudio de entrada: PCM (`pcm_16000` por defeito) ou `ulaw_8000`. Não aceita mp3/webm.
- `previous_text` só no primeiro chunk e funciona melhor abaixo de 50 caracteres.
- O servidor fecha a ligação após 15 s sem mensagens do cliente; é preciso continuar a enviar áudio (silêncio conta).

## Fase 2 (não implementada)

Nomeação de oradores, ligação a streams de áudio via ffmpeg num worker, resumos periódicos por IA, persistência em Postgres e partilha de sessões.
