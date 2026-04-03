import Anthropic from "@anthropic-ai/sdk";

const TROPES_LIST = [
  "enemies to lovers","slow burn","forced proximity","found family","friends to lovers",
  "segunda chance","amor proibido","fake dating","only one bed","grumpy x sunshine",
  "morally grey","escolhida","mundo oculto","fantasia epica","fantasia urbana",
  "romance de epoca","magia elemental","fae romance","vampiros","lobisomens",
  "academia de magia","heroina forte","dark romance","marriage of convenience",
  "rivals to lovers","narrador duvidoso","distopia","pos-apocaliptico",
  "realismo magico","viagem no tempo","recontagem de mito"
];

const GENRES = [
  "romantasia","fantasia","romance","ficcao cientifica","thriller",
  "misterio","ficcao historica","ficcao contemporanea","horror","young adult"
];

export async function POST(request) {
  try {
    const { title, authors, description } = await request.json();

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: `Classifique este livro em tropes e generos literarios.

Titulo: ${title}
Autor(es): ${authors}
Sinopse: ${description}

Responda APENAS com JSON valido, sem markdown, sem crases, neste formato exato:
{"genres":["genero1","genero2"],"tropes":["trope1","trope2","trope3"],"summary":"resumo de 1 frase do livro em portugues"}

Use apenas generos desta lista: ${GENRES.join(", ")}
Use apenas tropes desta lista: ${TROPES_LIST.join(", ")}
Selecione de 1 a 3 generos e de 2 a 5 tropes que melhor descrevem o livro.`,
        },
      ],
    });

    const text = message.content[0].text;
    const clean = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);

    return Response.json(result);
  } catch (e) {
    console.error("classify error:", e);
    return Response.json({ genres: [], tropes: [], summary: "" }, { status: 500 });
  }
}
