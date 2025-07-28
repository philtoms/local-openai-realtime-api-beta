import { Ollama } from 'ollama';

export const initialiseModel = (url = 'http://127.0.0.1:11434') => {
  const ollama = new Ollama({ host: url });

  // const MODEL_NAME = "deepseek-r1"; // reasoning model
  // const MODEL_NAME = "gemma3:1b";
  // const MODEL_NAME = "gemma3:27b-it-qat";
  const MODEL_NAME = 'magistral';

  async function generate(messages, cb) {
    try {
      const response = await ollama.chat({
        model: MODEL_NAME,
        messages,
        stream: false,
      });
      const text = response.message.content.replace('</end_of_turn>\n', '');
      if (cb) {
        cb({ text });
      }
      return text;
    } catch (error) {
      // Handle potential errors, such as the Ollama server not being available
      if (
        error instanceof TypeError &&
        error.message.includes('fetch failed')
      ) {
        return `Error: Connection refused. Is the Ollama server running at ${url}?`;
      }
      if (error instanceof Error) {
        return `An error occurred: ${error.message}`;
      }
      return `An unexpected error occurred: ${String(error)}`;
    }
  }

  return { generate };
};
