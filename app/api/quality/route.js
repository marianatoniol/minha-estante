import Anthropic from "@anthropic-ai/sdk";
import { parseAIJson } from "../../../lib/utils";

export async function POST(request) {
  try {
    const { title, authors, description, pageCount } = await request.json();

    if (!title || typeof title !== "string" || !title.trim()) {
      return Response.json({ error: "title is required" }, { status: 400 });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `Analise se este e um livro real de ficcao/nao-ficcao para leitores comuns. Responda APENAS com JSON: {"is_spam": boolean, "quality_score": number, "reason": "string"}. is_spam e true se for: livro academico analisando outro livro, resumo/analise de obra alheia, spam, conteudo irrelevante, menos de 50 paginas sem justificativa. quality_score vai de 0 a 10: 10 para bestsellers conhecidos, 8-9 para ficcao/nao-ficcao de qualidade, 5-7 para obras menos conhecidas, 0-4 para conteudo duvidoso. Livro: titulo: ${title}, autores: ${authors}, paginas: ${pageCount}, sinopse: ${description}`,
        },
      ],
    });

    const textBlock = message.content.find(b => b.type === "text");
    const text = textBlock?.text || "";
    if (!text) return Response.json({ is_spam: false, quality_score: 5, reason: "empty" });
    try {
      return Response.json(parseAIJson(text));
    } catch {
      return Response.json({ is_spam: false, quality_score: 5, reason: "parse_error" });
    }
  } catch (e) {
    console.error("quality error:", e);
    return Response.json({ is_spam: false, quality_score: 5, reason: "error" }, { status: 500 });
  }
}
