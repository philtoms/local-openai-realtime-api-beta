import { RealtimeService } from "./service.js";

const service = new RealtimeService();

self.onmessage = async (event) => {
  service.onmessage(event, (res) => {
    self.postMessage(res);
  });
};
