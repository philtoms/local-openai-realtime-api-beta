import { RealtimeUtils } from "../utils";

export class RealtimeService {
  transcribe;
  chat;
  session = {};
  model;

  async onmessage({ data }, cb) {
    const event_id = RealtimeUtils.generateId("event_");
    switch (data.type) {
      case "session.create": {
        this.model = await import(/* @vite-ignore */ "./model.js");
        const id = this.model.createSession();
        this.session = { id, messages: [{ role: "system", content: "/no_think" }] };
        cb({ type: "session.created", event_id, id });
        break;
      }

      case "session.delete": {
        const id = this.session.id;
        this.model.deleteSession(id);
        this.session = {};
        cb({ type: "session.deleted", event_id, id });
        break;
      }

      case "session.update":
        if (data.session.instructions != this.session.instructions) {
          this.session.messages.push({ role: "system", content: data.session.instructions });
        }
        this.session = { ...this.session, ...data.session };
        cb({ type: "session.updated", event_id });
        break;

      case "input_audio_buffer.append": {
        const query = await this.model.transcribe(this.session.id, data.audio, cb);
        if (query) {
          this.session.hasQuery = query;
          this.session.messages.push({ role: "user", content: query });
          cb({ type: "input_audio_buffer.appended", event_id });
        }
        break;
      }

      case "input_audio_buffer.commit": {
        break;
      }

      case "conversation.item.create": {
        for (const content of data.item.content) {
          this.session.messages.push({ role: data.item.role, content: content.text });
        }
        const id = RealtimeUtils.generateId("content_");
        cb({
          event_id,
          type: "conversation.item.created",
          previous_item_id: this.session.contentId,
          item: { id, object: "realtime.item", type: "message", status: "completed", role: data.item.role, content: data.item.content },
        });
        this.session.contentId = id;
        break;
      }

      case "speak": {
        const { id } = this.session;
        this.model.speak(id, data.text, ({ audio }) => {
          // stream response
          cb({ type: "response.audio.delta", event_id, item_id: this.session.contentId, response_id: `res_${id}`, output_index: id, content_index: 0, delta: audio.audio });
        });
        break;
      }

      case "response.create": {
        const { id, messages } = this.session;
        let content_index = 0;
        if (this.session.hasQuery) {
          await this.model.chat(id, messages, ({ audio }) => {
            // stream response
            cb({ type: "response.audio.delta", event_id, item_id: this.session.contentId, response_id: `res_${id}`, output_index: id, content_index, delta: audio.audio });
          });
          cb({
            type: "response.created",
            event_id,
            response: { id: `resp_${id}`, object: "realtime.response", status: "in_progress", status_details: null, output: [], usage: null },
          });
          this.session.hasQuery = false;
        }
        break;
      }
    }
  }
}
