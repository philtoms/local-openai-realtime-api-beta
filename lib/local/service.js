import { RealtimeUtils } from '../utils.js';

export class RealtimeService {
  session = {};
  model;

  async handle(event, cb) {
    const data = event.data;
    if (!data) {
      console.error('No data in event:', event);
      return;
    }
    console.log('Received event:', data.type);
    const event_id = RealtimeUtils.generateId('event_');
    switch (data.type) {
      case 'model.create': {
        const { Model } = await import(/* @vite-ignore */ './model.js');
        this.model = await Model(data.modelConfig);
        cb({ type: 'model.created', event_id });
        break;
      }

      case 'session.create': {
        const id = this.model.createSession();
        this.session = {
          id,
          system: [{ role: 'system', content: '/no_think' }],
          user: [{ role: 'system', content: '/no_think' }],
          transcriptions: [],
        };
        cb({ type: 'session.created', event_id, id });
        break;
      }

      case 'session.delete': {
        const id = this.session.id;
        this.model.deleteSession(id);
        this.session = {};
        cb({ type: 'session.deleted', event_id, id });
        break;
      }

      case 'session.update':
        if (data.session.instructions != this.session.instructions) {
          this.session.system.push({
            role: 'system',
            content: data.session.instructions,
          });
        }
        this.session = { ...this.session, ...data.session };
        cb({ type: 'session.updated', event_id });
        break;

      case 'input_audio_buffer.append': {
        const transcription = this.model.transcribe(
          this.session.id,
          data.audio,
          cb,
        );
        this.session.transcriptions.push(transcription);
        const query = await transcription;
        if (query) {
          this.session.hasQuery = query;
          this.session.user.push({ role: 'user', content: query });
          console.log('Transcribed query:', query);
          cb({ type: 'input_audio_buffer.appended', event_id });
        }
        break;
      }

      case 'input_audio_buffer.commit': {
        break;
      }

      case 'conversation.item.create': {
        for (const content of data.item.content) {
          this.session[data.item.role].push({
            role: data.item.role,
            content: content.text,
          });
        }
        const id = RealtimeUtils.generateId('content_');
        cb({
          event_id,
          type: 'conversation.item.created',
          previous_item_id: this.session.contentId,
          item: {
            id,
            object: 'realtime.item',
            type: 'message',
            status: 'completed',
            role: data.item.role,
            content: data.item.content,
          },
        });
        this.session.contentId = id;
        break;
      }

      case 'speak': {
        const { id } = this.session;
        this.model.speak(id, data.text, ({ audio }) => {
          // stream response
          cb({
            type: 'response.audio.delta',
            event_id,
            item_id: this.session.contentId,
            response_id: `res_${id}`,
            output_index: id,
            content_index: 0,
            delta: audio.audio,
          });
        });
        break;
      }

      case 'response.create': {
        const { id, user, system } = this.session;
        let content_index = 0;
        await Promise.all(this.session.transcriptions);
        this.session.transcriptions = [];
        if (this.session.hasQuery) {
          const messages = [...system, ...user];
          console.log(messages);
          const response = await this.model.chat(id, messages, ({ audio }) => {
            // stream response
            cb({
              type: 'response.audio.delta',
              event_id,
              item_id: this.session.contentId,
              response_id: `res_${id}`,
              output_index: id,
              content_index,
              delta: audio.audio,
            });
          });
          console.log('Chat response', response);
          cb({
            type: 'response.created',
            event_id,
            response: {
              id: `resp_${id}`,
              object: 'realtime.response',
              status: 'in_progress',
              status_details: null,
              output: [],
              usage: null,
            },
          });
          this.session.hasQuery = false;
        }
        break;
      }
    }
  }
}
