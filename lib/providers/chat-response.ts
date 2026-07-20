export const extractJsonObject = (text: string) => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
};
export const extractChatResponseText = (result: unknown) => {
  const response = result as {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
    choices?: Array<{ message?: { content?: string }; text?: string }>;
  };

  if (typeof response?.output_text === "string" && response.output_text) {
    return response.output_text;
  }

  if (Array.isArray(response?.output)) {
    for (const item of response.output) {
      if (item?.type !== "message" || !Array.isArray(item.content)) continue;
      const text = item.content.find(
        (content) => content?.type === "output_text",
      )?.text;
      if (text) return text;
    }
  }

  return (
    response?.choices?.[0]?.message?.content ??
    response?.choices?.[0]?.text ??
    ""
  );
};
