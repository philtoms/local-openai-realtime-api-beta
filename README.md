# Reference Client: Local Realtime API (beta)

This repository contains a reference client aka sample library for connecting
to services that support OpenAI's Realtime chat API.

Obviously this includes OpenAI's Realtime API endpoint, but it also supports a configurable model through which the STT, TTS and LLM services can be configured (even at run time) to tailor the requirements and capabilities of the application. A typical model configuration might be set up to handle SST and TTS by using the `huggingface/transformers.js` library to load ONNX models directly into the browser, whilst offloading the LLM component to a dedicated cloud service:

```
{
    tts: {
      model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      dtype: 'fp32'
    },
    llm: {
      adapter: 'openai',
      model: "o3"
    },
    stt: {
      model: 'onnx-community/whisper-base'
    },
}
```

# Quickstart

```shell
$ npm i @pipsqueek/local-realtime-api-beta --save
```

```javascript
import {
  RealtimeClient,
  defaultModelConfig,
} from '@pipsqueek/local-realtime-api-beta';

const client = new RealtimeClient({
  apiKey: process.env.OPENAI_API_KEY,
  modelConfig: defaultModelConfig,
});
```

# Relay server

This package also supports the relay server pattern allowing you to host all of your chat services locally on dedicated hardware. This setup also supports dynamic model configuration.

```javascript
const client = new RealtimeClient({ url: RELAY_SERVER_URL });
```

```javascript
import express from 'express';
import {
  startRealtimeServer,
  defaultModelConfig,
} from '@pipsqueek/local-realtime-api-beta';

const app = express();
const PORT = process.env.PORT || 30310;

// Create an HTTP server and attach express
const server = http.createServer(app);

// Create socket servers and attach on upgrade
const wss = startRealtimeServer(defaultModelConfig);

server.on('upgrade', async function upgrade(request, socket, head) {
  wss.handleUpgrade(request, socket, head, function done(ws) {
    socketHandler.emit('connection', ws, request);
  });
});

// Start the HTTP server
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
```
