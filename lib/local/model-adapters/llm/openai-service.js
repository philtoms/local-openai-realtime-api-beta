import OpenAI from 'openai';

export const initialiseModel = (
  {
    model = 'deepseek/deepseek-chat-v3-0324:free',
    url = 'https://openrouter.ai/api/v1',
  },
  apiKey,
) => {
  const openai = new OpenAI({
    baseURL: url,
    apiKey,
  });

  const generate = async (messages, cb) => {
    const completion = await openai.chat.completions.create({
      model,
      messages,
    });

    const text = completion.choices[0].message.content;
    if (cb) {
      cb({ text });
    }
    return text;
  };

  return { generate };
};
