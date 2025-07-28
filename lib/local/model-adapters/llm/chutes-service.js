export const initialiseModel = (
  {
    url = 'https://llm.chutes.ai/v1/chat/completions',
    model = 'zai-org/GLM-4.5-Air',
  },
  apiToken,
) => {
  const generate = async (messages, cb) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    const data = await response.json();
    const text = data.choices[0].message.content;
    if (cb) {
      cb({ text });
    }
    return text;
  };

  return { generate };
};
