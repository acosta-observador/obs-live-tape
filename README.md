# OBS Live Tape

Transcrição em direto para jornalistas do Observador (comissões de inquérito, audições parlamentares, etc.), com o Scribe v2 Realtime da ElevenLabs.

> A transcrição é um **rascunho de trabalho**. A interface mostra sempre o aviso "Transcrição automática. Confirmar citações contra o áudio."

## Estado do projeto

| Etapa | Conteúdo | Estado |
|---|---|---|
| 1 | Base, login por palavra-passe, rota do token, deploy | feito |
| 2 | Cliente realtime, ecrã de transcrição ao vivo, nível do microfone, timestamps, vocabulário, reconexão automática, `/diagnostico` | feito (testado com servidor simulado) |
| 3 | Gravação local de áudio (MediaRecorder + IndexedDB) e sessão guardada contra refresh | por fazer |
| 5 | Marcadores, pesquisa e palavras de alerta | por fazer |
| 6 | Exportação .txt / .srt / .docx | por fazer |

## Como funciona (arquitetura)

- Next.js 16 (App Router) + TypeScript + Tailwind, como Web Service no Render.
- O browser **liga-se diretamente à ElevenLabs**; o áudio não passa pelo nosso servidor.
- A chave `ELEVENLABS_API_KEY` **só existe no servidor**. A rota `POST /api/scribe-token` pede à ElevenLabs um token de uso único (15 min para ser usado) e devolve apenas esse token.
- Todo o acesso é protegido por uma palavra-passe partilhada. O `proxy.ts` (o antigo "middleware" do Next) exige um cookie de sessão httpOnly assinado (HMAC) em todas as páginas e APIs, exceto `/login` e `/api/login`. A rota do token volta a verificar a sessão.
- O servidor **não regista conteúdo de transcrições nem áudio**. Só regista o código HTTP de falhas ao pedir tokens.

## Transcrição ao vivo (como funciona)

- O microfone é captado a 16 kHz mono (AudioWorklet) e enviado em blocos de ~128 ms (`pcm_16000`). Cancelamento de eco e supressão de ruído estão **desligados** de propósito: se a audição tocar nas colunas do mesmo computador, o cancelamento de eco apagaria o áudio que queremos transcrever.
- Texto **parcial** a cinzento, **confirmado** a branco (tema escuro), com timestamps `hh:mm:ss` contados desde o início da sessão. Se paras e voltas a iniciar, a contagem continua.
- O scroll acompanha o texto novo e pára se subires; aparece "Ir para o fim".
- **Reconexão automática**: se a ligação cair, a app pede um token novo e liga outra vez (espera 1 s, 2 s, 4 s… até 10 s entre tentativas). O áudio captado nesse intervalo fica em memória (até 90 s) e é enviado depois, a 3x a velocidade real. A transcrição mostra um aviso "Ligação interrompida" com o intervalo e se algum áudio ficou sem transcrever. Na nova ligação envia-se `previous_text` com as últimas palavras confirmadas (a API recomenda menos de 50 caracteres).
- O ecrã fica aceso durante a gravação (Wake Lock) e o browser avisa antes de fechar/recarregar a página.
- **Vocabulário**: cada linha das Definições vai como `keyterms` (máx. 50 termos de 50 caracteres).
- `/diagnostico` liga com os parâmetros que escolheres (modelo, `pt` ou `por`, keyterms) e mostra as mensagens em bruto, para validar a API no browser.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `ELEVENLABS_API_KEY` | sim | Chave da ElevenLabs. Cria uma só para este projeto, com permissões mínimas e limite de créditos. |
| `APP_ACCESS_PASSWORD` | sim | Palavra-passe partilhada. Mudá-la termina todas as sessões abertas. |
| `SESSION_SECRET` | não | Segredo extra para assinar os cookies. |
| `SCRIBE_MAX_SESSION_SECONDS` | não | Fecha a sessão realtime ao fim de N segundos. |
| `ELEVENLABS_API_BASE` | não | Endpoint HTTP da ElevenLabs (por defeito `https://api.elevenlabs.io`; ex. UE: `https://api.eu.residency.elevenlabs.io`). |
| `NEXT_PUBLIC_SCRIBE_WS_BASE` | não | Base do WebSocket (por defeito `wss://api.elevenlabs.io`). Tem de combinar com a região escolhida e é lida **na build**. |

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
app/page.tsx                  ecrã principal (components/LiveScreen.tsx)
app/diagnostico/page.tsx      página técnica para testar a API no browser
components/                   LiveScreen, TranscriptView, LevelBars, SettingsSheet
lib/session/controller.ts     sessão: microfone -> WebSocket -> segmentos, fila de áudio, reconexão
lib/scribe/                   protocolo, ligação WebSocket, pedido de token
lib/audio/mic.ts              captura do microfone (AudioWorklet, PCM 16 kHz)
lib/settings.ts               definições guardadas no browser
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
