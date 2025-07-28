import { RealtimeEventHandler } from './event_handler.js';
import { RealtimeUtils } from './utils.js';

let worker = null;
let isReady = false;

export const defaultModelConfig = {
  tts: {
    model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    dtype: 'fp32',
  },
  llm: {
    model: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',
    dtype: 'q4f16',
    device: 'webgpu',
  },
  stt: {
    model: 'onnx-community/whisper-base',
  },
};

export class LocalRealtimeAPI extends RealtimeEventHandler {
  modelUrl;
  resolveModel;
  modelConfig;
  /**
   * Create a new RealtimeAPI instance (Singleton)
   * @returns {LocalRealtimeAPI}
   */
  constructor({ apiKey, debug, modelConfig }) {
    if (LocalRealtimeAPI._instance) {
      return LocalRealtimeAPI._instance;
    }
    super();
    LocalRealtimeAPI._instance = this;
    this.debug = !!debug;
    if (globalThis.document && this.apiKey) {
      if (!dangerouslyAllowAPIKeyInBrowser) {
        throw new Error(
          `Can not provide API key in the browser without "dangerouslyAllowAPIKeyInBrowser" set to true`,
        );
      }
    }
    this.modelConfig = modelConfig ?? defaultModelConfig;
    this.modelConfig.apiKey = apiKey;

    const needsAPIKey =
      !apiKey &&
      Object.values(this.modelConfig).find(({ adapter }) => !!adapter);
    // warm start is possible
    if (!needsAPIKey) {
      this.loadModel();
    }
  }

  /**
   * Tells us whether or not the Worker is connected (and ready)
   * @returns {boolean}
   */
  isConnected() {
    return !!isReady;
  }

  /**
   * Writes Worker logs to console
   * @param  {...any} args
   * @returns {true}
   */
  log(...args) {
    const date = new Date().toISOString();
    const logs = [`[Worker/${date}]`].concat(args).map((arg) => {
      if (typeof arg === 'object' && arg !== null) {
        return JSON.stringify(arg, null, 2);
      } else {
        return arg;
      }
    });
    if (this.debug) {
      console.log(...logs);
    }
    return true;
  }

  onMessage = (event) => {
    const message = event.data;
    if (message.type === 'model.created') {
      this.resolveModel(true);
    }
    this.receive(message.type, message);
  };

  onError = (error) => {
    console.error(error);
    this.disconnect();
  };

  async loadModel() {
    if (!worker) {
      globalThis.modelReady = new Promise((resolve) => {
        this.resolveModel = resolve;
      });
      worker = new Worker(new URL('./local/worker.js', import.meta.url), {
        type: 'module',
      });
      worker.addEventListener('message', this.onMessage);
      worker.addEventListener('error', this.onError);
      worker.postMessage({
        type: 'model.create',
        modelConfig: this.modelConfig,
      });
      await globalThis.modelReady;
    }
    worker.postMessage({
      type: 'session.create',
    });
  }
  /**
   * Connects to Realtime API Worker Server
   * @param {{model?: string}} [settings]
   * @returns {Promise<true>}
   */
  async connect() {
    this.loadModel();
    isReady = true;
    return true;
  }

  /**
   * Disconnects from Realtime API server
   * @returns {true}
   */
  disconnect() {
    worker.postMessage({ type: 'session.delete' });
    isReady = false;
    return true;
  }

  /**
   * Receives an event from Worker and dispatches as "server.{eventName}" and "server.*" events
   * @param {string} eventName
   * @param {{[key: string]: any}} event
   * @returns {true}
   */
  receive(eventName, event) {
    this.log(`received:`, eventName, event);
    this.dispatch(`server.${eventName}`, event);
    this.dispatch('server.*', event);
    return true;
  }

  /**
   * Sends an event to Worker and dispatches as "client.{eventName}" and "client.*" events
   * @param {string} eventName
   * @param {{[key: string]: any}} event
   * @returns {true}
   */
  send(eventName, data) {
    if (!this.isConnected()) {
      throw new Error(`RealtimeAPI is not connected`);
    }
    data = data || {};
    if (typeof data !== 'object') {
      throw new Error(`data must be an object`);
    }
    const event = {
      event_id: RealtimeUtils.generateId('evt_'),
      type: eventName,
      ...data,
    };
    this.dispatch(`client.${eventName}`, event);
    this.dispatch('client.*', event);
    this.log(`sent:`, eventName, event);
    worker.postMessage(event);
    return true;
  }

  speak(text) {
    worker.postMessage({ type: 'speak', text });
  }
}
