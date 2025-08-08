import { WebSocketServer } from 'ws';
import { RealtimeService } from './local/service.js';
import { RealtimeUtils } from './utils.js';

export const defaultModelConfig = {
  tts: {
    model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  },
  llm: {
    model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',
    dtype: 'q4f16',
    device: 'coda',
  },
  stt: {
    model: 'onnx-community/whisper-base',
  },
};

export function startRealtimeServer(modelConfig = defaultModelConfig) {
  const wss = new WebSocketServer({ noServer: true });

  const service = new RealtimeService();

  // warm start...
  service.handle({ data: { type: 'model.create', modelConfig } }, () => {
    console.log('Warm Service Initiated');
  });

  wss.on('connection', async (ws, request) => {
    service.handle(
      { data: { type: 'session.create', modelConfig } },
      ({ id }) => {
        console.log(`Session id created:`, id);
      },
    );

    console.log(`Realtime socket server attached to HTTP server`);

    ws.on('message', async (message) => {
      const data = JSON.parse(message.toString());
      if (data.audio) {
        const arrayBuffer = RealtimeUtils.base64ToArrayBuffer(data.audio);
        data.audio = RealtimeUtils.arrayBufferToFloat32(arrayBuffer);
      }
      service.handle({ data }, (res) => {
        if (res.audio) {
          res.audio = RealtimeUtils.floatTo16BitPCM(res.audio);
        }
        ws.send(JSON.stringify(res));
      });
    });

    ws.on('close', () => {
      service.handle({ type: 'session.delete' }, ({ id }) => {
        console.log(`Session id deleted:`, id);
      });
      console.log('Client disconnected');
    });

    ws.on('error', (error) => {
      service.handle({ type: 'session.delete' }, ({ id }) => {
        console.log(`Session id deleted:`, id);
      });
      console.error('WebSocket error:', error);
    });

    ws.send(
      JSON.stringify({ message: 'Welcome to the Local Realtime server!' }),
    );
  });

  return wss;
}
