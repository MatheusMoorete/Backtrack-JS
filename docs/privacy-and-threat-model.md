# Catálogo de Dados Proibidos e Threat Model — Flight Recorder v0.1

## 1. Princípio Fundamental e Invariante

A sanitização ocorre **antes** de qualquer escrita na fila em memória ou no IndexedDB.
A exportação de arquivos e o viewer **não** são a primeira linha de defesa.
Todo dado que chega ao storage já deve estar em conformidade com as regras de redação.

---

## 2. Catálogo de Dados Proibidos

### 2.1 Chaves Sensíveis (Correspondência Case-Insensitive)

Qualquer propriedade de objeto cuja chave contenha (ou seja igual a) um dos termos abaixo terá seu valor substituído por `"[REDACTED]"`:

```text
password
senha
token
authorization
cookie
secret
cvv
cvc
card
credit
cardNumber
securityCode
cpf
cnpj
email
phone
telefone
celular
otp
verificationCode
recoveryCode
accessToken
refreshToken
apiKey
pin
```

### 2.2 Padrões de Strings Sensíveis

Strings em argumentos de console, erros ou metadados são inspecionadas por expressões regulares para redação preventiva:

1. **Tokens de Autorização**:
   - `Bearer\s+[A-Za-z0-9\-_=.]+` -> `Bearer [REDACTED_TOKEN]`
   - `Basic\s+[A-Za-z0-9+/=]+` -> `Basic [REDACTED_BASIC]`
2. **JSON Web Tokens (JWT)**:
   - `eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]*` -> `[REDACTED_JWT]`
3. **E-mails**:
   - `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}` -> `[REDACTED_EMAIL]`
4. **Documentos Brasileiros**:
   - CPF: `\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b` -> `[REDACTED_CPF]`
   - CNPJ: `\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b` -> `[REDACTED_CNPJ]`
5. **Cartões de Crédito**:
   - `\b(?:\d[ -]*?){13,19}\b` (sequências numéricas com 13 a 19 dígitos) -> `[REDACTED_CARD]`
6. **Telefones**:
   - `(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\d{4}|\d{4})[ -]?\d{4}` -> `[REDACTED_PHONE]`

### 2.3 Regras de Higienização de URL

1. Remover fragments (`#...`);
2. Preservar `origin` e `pathname`;
3. Preservar **somente os nomes** dos query parameters ordenados (ex: `?email&token` em vez de `?email=foo&token=bar`);
4. Substituir identificadores únicos em path:
   - UUIDs (`/[a-f0-9-]{36}/i`) -> `/:id`
   - IDs numéricos longos (`/\b\d{6,}\b/`) -> `/:id`

---

## 3. Threat Model

### 3.1 Modelo do Recorder (No Navegador do uTicket)

| Ameaça | Vetor de Ataque | Mitigação |
| --- | --- | --- |
| **Vazamento de PII / Segredos** | Console acidental, mutação DOM contendo senhas ou cartões | Sanitização universal pré-storage; `maskAllInputs: true`; redação regex; bloqueio de mídia e canvas. |
| **Denial of Service (DoS) da Aplicação** | Loop de console infinito ou mutações massivas de DOM consumindo memória | Buffer circular limitado (50 MB); descarte com prioridade (mousemove -> visual -> log); batching de IndexedDB; limites de profundidade/itens na serialização. |
| **Corrupção de Estado / Interferência** | Falha de persistência no IndexedDB ou bug interno no recorder | Tratamento isolado em try/catch; transição para estado `degraded`; nunca relança exceções; restauração segura de wrappers originais no `stop()`. |
| **Isolamento de Origem** | Outras abas acessando a mesma gravação | Chaveamento estrito por `sessionId` e `tabId` via `sessionStorage`. |

### 3.2 Modelo do Viewer (Ao Abrir Arquivo `.ffr.json`)

| Ameaça | Vetor de Ataque | Mitigação |
| --- | --- | --- |
| **XSS via Replay do Snapshot rrweb** | Script malicioso embutido em tags `<script>` ou handlers `onload`/`onerror` no DOM gravado | O viewer executa o replay dentro de um `<iframe>` sandboxed (`sandbox="allow-same-origin"` sem `allow-scripts` para código do app gravado); desabilita execução de scripts. |
| **XSS via Console / Mensagens de Erro** | Strings de log contendo tags HTML ou javascript malicioso | Toda renderização de texto de console, stack e URLs é tratada estritamente como texto puro (`textContent` / escaping no React). |
| **Exfiltração de Dados (Phone Home)** | Imagens ou links externos embutidos tentando carregar recursos remotos | CSP (Content Security Policy) estrita no viewer bloqueando conexões externas (`connect-src 'none'`, `img-src data: blob: 'self'`). |
| **Bomba de Descompressão / DoS de Arquivo** | Arquivo `.ffr.json` com centenas de MBs travando a aba do viewer | Limite máximo estrito de tamanho no `File.size` antes de executar `File.text()` ou `JSON.parse`. |

---

## 4. Decisões Abertas Registradas

1. **Amostragem de Replay em Telas de Alta Criticidade**:
   - Em Auth (login, OTP) e Checkout (dados de pagamento), a matriz de telemetria poderá desabilitar o rrweb e manter apenas timeline de erro/rede/navegação. Essa decisão será formalizada no Lote 4.
2. **Suporte a Safari/Firefox**:
   - Piloto validado inicialmente no Chrome. Os ajustes de compatibilidade fina de IndexedDB no Safari/Firefox serão o gate para encerramento da v0.1 no Lote 5.
