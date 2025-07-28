import { GoogleGenAI } from '@google/genai';

export const initialiseModel = (
  { model = 'gemini-2.5-flash-preview-04-17' },
  apiKey,
) => {
  const ai = new GoogleGenAI({ apiKey });
  async function generate(messages, streamCallback) {
    const config = {
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'text/plain',
    };
    const contents = messages.map(({ role, content }) => [
      { role, parts: [{ text: content }] },
    ]);
    const response = await ai.models.generateContentStream({
      model,
      config,
      contents,
    });
    let responseText = '';
    for await (const chunk of response) {
      if (streamCallback && chunk.text) {
        responseText += chunk.text;
        streamCallback(chunk.text);
      }
    }
    return responseText;
  }

  return { generate };
};
