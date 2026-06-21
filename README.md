# PushBus POC REAL 001A

POC em Node/Express + Leaflet para **teste de campo com GPS real da API Cittati/FLITS**.  
Esta versão foi refatorada para não depender de simulação: o servidor consulta a telemetria real, calcula geofence, ponto mais próximo, próximo ponto e ETA estimado para as três telas.

Pontos da Linha 001A usados na POC:

- HOSPITAL UNIMED antes da Estância 4 Irmãos.
- COHAB ESTÂNCIA 4 IRMÃOS.
- Pontos intermediários entre Estância e Rodoviária.
- MEIA LUA RODOVIÁRIA como ponto de integração/final deste recorte.

## Telas

```text
http://localhost:3000/mapa.html       Mapa Leaflet com pontos, geofence e ônibus real
http://localhost:3000/historico.html  Histórico de passagem em geofence
http://localhost:3000/linha.html      Timeline responsiva para visão do passageiro
```

Todas consomem:

```http
GET /api/poc/001A/state
```

## Importante

Esta versão **não cai para mock automaticamente**.

Se a API real não retornar veículo compatível com a Linha 001A, as telas mostram aviso de "nenhum carro localizado" em vez de simular posição falsa. Isso é intencional para teste em rua.

## Subir localmente

```bash
cp .env.example .env
npm install
npm start
```

## Subir com Docker

```bash
cp .env.example .env
docker compose up --build
```

Acesse:

```text
http://localhost:3000
```

## Configuração `.env`

Preencha o `.env` com os dados reais:

```env
PORT=3000
ALLOW_MOCK=false
POLL_INTERVAL_SECONDS=5
STALE_AFTER_SECONDS=90

LINE_CODE=01A
LINE_CODE_ALT=001A
STRICT_LINE_FILTER=true

CITTATI_BASE_URL=https://flits.cittati.com.br
CITTATI_APP_CODE=200
CITTATI_CLIENT_ID=1
CITTATI_COMPANY_ID=...
CITTATI_USERNAME=...
CITTATI_PASSWORD=...
CITTATI_TOKEN=

DEFAULT_VEHICLES=26002
DEFAULT_LINES=
```

### Campo mais importante para o teste

Use `DEFAULT_VEHICLES` para informar o carro real que você vai acompanhar em campo.

Exemplo:

```env
DEFAULT_VEHICLES=26002
```

Também pode testar mais de um carro:

```env
DEFAULT_VEHICLES=26002,26003,26004
```

Se `DEFAULT_VEHICLES` ficar vazio, o servidor usa uma lista de veículos de referência do projeto anterior, mas para validação em rua o ideal é informar o carro da Linha 001A.

## Endpoints de conferência

### Verificar configuração

```http
GET /api/health
```

Deve retornar:

```json
{
  "mode": "real-flits",
  "missingConfig": [],
  "companyIdConfigured": true,
  "loginConfigured": true
}
```

### Forçar login na FLITS

```http
POST /api/auth/login
```

### Consultar veículos reais diretamente

```http
POST /api/vehicles/positions
Content-Type: application/json

{
  "lineCode": "01A",
  "vehicles": [26002]
}
```

### Estado da POC

```http
GET /api/poc/001A/state
```

Retorna:

- `source: "flits"`
- `mode: "real"`
- `vehicle`: ônibus localizado pela API real
- `progress.nearest`: ponto mais próximo
- `progress.nextPoint`: próximo ponto e ETA estimado
- `progress.gps.status`: `online`, `stale`, `unknown` ou `no_vehicle`
- `history`: passagens registradas em geofence

### Resetar teste de campo

```http
POST /api/poc/001A/reset
```

Use antes de iniciar uma nova rodada no local para limpar histórico e memória de pontos atendidos.

## Ajustes para teste em campo

### GPS antigo

O padrão considera GPS antigo depois de 90 segundos:

```env
STALE_AFTER_SECONDS=90
```

Se a API atualizar em janela maior, ajuste para 120 ou 180.

### Filtro de linha

Se a API retornar o carro, mas o campo da linha vier com descrição diferente, temporariamente teste:

```env
STRICT_LINE_FILTER=false
```

Isso permite validar primeiro se o veículo aparece. Depois volte para `true` e ajuste `LINE_CODE`, `LINE_CODE_ALT`, `DEFAULT_VEHICLES` ou `DEFAULT_LINES`.

### Frequência de atualização

As telas consultam a API local a cada 5 segundos:

```env
POLL_INTERVAL_SECONDS=5
```

A interface já está configurada para atualizar a cada 5 segundos.

## Estrutura

```text
pushbus-poc-001a/
├── server.js
├── data/line001A.js
├── public/
│   ├── mapa.html
│   ├── historico.html
│   ├── linha.html
│   ├── css/app.css
│   └── js/
│       ├── api.js
│       ├── mapa.js
│       ├── historico.js
│       └── linha.js
├── Dockerfile
├── docker-compose.yml
├── package.json
├── .env.example
└── README.md
```

## Observações técnicas

- O `server.js` mantém o token apenas em memória.
- O navegador nunca recebe usuário, senha ou token da Cittati.
- As páginas consomem somente endpoints locais.
- O traçado do mapa ainda liga os pontos da planilha; para homologação visual de rota, substitua por KML/KMZ oficial.
- A geofence usa raio de entrada dos pontos da base `data/line001A.js`.
