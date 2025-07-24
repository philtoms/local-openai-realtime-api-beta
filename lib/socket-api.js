import { WebSocketServer } from "ws";
import { RealtimeService } from "./local/service";
import { RealtimeUtils } from "./utils";

export function startRealtimeServer() {
  const wss = new WebSocketServer({ noServer: true });

  // warm start...
  const service = new RealtimeService();
  process.env.DEVICE = "cpu";
  service.onmessage({ data: { type: "session.create" } }, () => {
    service.onmessage({ data: { type: "session.delete" } }, () => {
      console.log(`Warm Service Initiated`);
    });
  });

  wss.on("connection", async (ws, request) => {
    const service = new RealtimeService();

    service.onmessage({ data: { type: "session.create" } }, ({ id }) => {
      console.log(`Session id created:`, id);
    });

    console.log(`Realtime socket server attached to HTTP server`);

    ws.on("message", async (message) => {
      const data = JSON.parse(message.toString());
      if (data.audio) {
        const arrayBuffer = RealtimeUtils.base64ToArrayBuffer(data.audio);
        data.audio = RealtimeUtils.arrayBufferToFloat32(arrayBuffer);
      }
      service.onmessage({ data }, (res) => {
        if (res.audio) {
          res.audio = RealtimeUtils.floatTo16BitPCM(res.audio);
        }
        ws.send(JSON.stringify(res));
      });
    });

    ws.on("close", () => {
      service.onmessage({ type: "session.delete" }, ({ id }) => {
        console.log(`Session id deleted:`, id);
      });
      console.log("Client disconnected");
    });

    ws.on("error", (error) => {
      service.onmessage({ type: "session.delete" }, ({ id }) => {
        console.log(`Session id deleted:`, id);
      });
      console.error("WebSocket error:", error);
    });

    ws.send(JSON.stringify({ message: "Welcome to the Local Realtime server!" }));
  });

  return wss;
}
