"use client";
import { useState, useEffect, useCallback, useRef } from "react";

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

const STATUS_COLORS = { lendo: "#639922", "quero ler": "#378ADD", lido: "#888780" };
const STATUS_LABELS = { lendo: "Lendo", "quero ler": "Quero ler", lido: "Lido" };

const COVER_GRADIENTS = [
  "linear-gradient(135deg,#2d1b4e,#6b3fa0,#c084fc)",
  "linear-gradient(135deg,#1a3a5c,#3b7dd8,#93c5fd)",
  "linear-gradient(135deg,#4a1c1c,#8b2525,#ef4444)",
  "linear-gradient(135deg,#1c3a2a,#2d6b4a,#4ade80)",
  "linear-gradient(135deg,#3d2b1f,#8b6b47,#d4a574)",
  "linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)",
  "linear-gradient(135deg,#5c1a1a,#b22222,#e74c3c)",
  "linear-gradient(135deg,#1a1a3e,#3d3d8e,#7b68ee)",
  "linear-gradient(135deg,#1c3a3a,#2e7d7d,#4fd1c5)",
  "linear-gradient(135deg,#3a1c3a,#7d2e7d,#c54fd1)",
];

function getGradient(title) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
  return COVER_GRADIENTS[Math.abs(hash) % COVER_GRADIENTS.length];
}

const STORAGE_KEY = "minha-estante-books";

function loadBooks() {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}
function saveBooks(books) {
  if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
}

async function searchGoogleBooks(query) {
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&langRestrict=pt&maxResults=5`);
    const data = await res.json();
    if (!data.items) return [];
    return data.items.map(item => {
      const v = item.volumeInfo;
      return {
        googleId: item.id,
        title: v.title || "",
        authors: v.authors || [],
        description: v.description || "",
        cover: v.imageLinks?.thumbnail?.replace("http:", "https:") || null,
        publishedDate: v.publishedDate || "",
        pageCount: v.pageCount || 0,
        categories: v.categories || [],
      };
    });
  } catch { return []; }
}

async function classifyWithAI(apiKey, title, authors, description) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: `Classifique este livro em tropes e generos literarios.

Titulo: ${title}
Autor(es): ${authors}
Sinopse: ${description}

Responda APENAS com JSON valido, sem markdown, sem crases, neste formato exato:
{"genres":["genero1","genero2"],"tropes":["trope1","trope2","trope3"],"summary":"resumo de 1 frase do livro em portugues"}

Use apenas generos desta lista: ${GENRES.join(", ")}
Use apenas tropes desta lista: ${TROPES_LIST.join(", ")}
Selecione de 1 a 3 generos e de 2 a 5 tropes que melhor descrevem o livro.` }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || "";
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch(e) {
    console.error("AI classification error:", e);
    return { genres: [], tropes: [], summary: "" };
  }
}

function TagPill({ label, color = "purple" }) {
  const colors = {
    purple: { bg: "#EEEDFE", text: "#3C3489" },
    pink: { bg: "#FBEAF0", text: "#72243E" },
    coral: { bg: "#FAECE7", text: "#712B13" },
    teal: { bg: "#E1F5EE", text: "#085041" },
    amber: { bg: "#FAEEDA", text: "#633806" },
    blue: { bg: "#E6F1FB", text: "#0C447C" },
    gray: { bg: "#F1EFE8", text: "#444441" },
    green: { bg: "#EAF3DE", text: "#27500A" },
    red: { bg: "#FCEBEB", text: "#791F1F" },
  };
  const c = colors[color] || colors.purple;
  return (
    <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 12, background: c.bg, color: c.text, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

const TROPE_COLORS = {
  "enemies to lovers": "pink", "slow burn": "pink", "forced proximity": "coral",
  "found family": "teal", "friends to lovers": "pink", "segunda chance": "amber",
  "amor proibido": "red", "fake dating": "coral", "only one bed": "coral",
  "grumpy x sunshine": "amber", "morally grey": "gray", "escolhida": "coral",
  "mundo oculto": "teal", "fantasia epica": "purple", "fantasia urbana": "purple",
  "romance de epoca": "amber", "magia elemental": "amber", "fae romance": "teal",
  "vampiros": "red", "lobisomens": "gray", "academia de magia": "purple",
  "heroina forte": "pink", "dark romance": "red", "marriage of convenience": "coral",
  "rivals to lovers": "pink", "narrador duvidoso": "gray", "distopia": "gray",
  "pos-apocaliptico": "gray", "realismo magico": "teal", "viagem no tempo": "blue",
  "recontagem de mito": "amber",
};

const GENRE_COLORS = {
  romantasia: "pink", fantasia: "purple", romance: "pink", "ficcao cientifica": "blue",
  thriller: "gray", misterio: "gray", "ficcao historica": "amber",
  "ficcao contemporanea": "teal", horror: "red", "young adult": "coral",
};

function StatusDot({ status }) {
  return (
    <div style={{
      position: "absolute", top: 6, right: 6, width: 10, height: 10,
      borderRadius: "50%", background: STATUS_COLORS[status] || "#888",
      border: "2px solid rgba(255,255,255,0.8)",
    }} />
  );
}

function BottomNav({ active, onNavigate }) {
  const items = [
    { key: "home", label: "Estante", icon: "M4 19.5v-15A2.5 2.5 0 016.5 2H20v20H6.5a2.5 2.5 0 010-5H20" },
    { key: "explore", label: "Explorar", icon: "M21 21l-5.35-5.35M11 19a8 8 0 100-16 8 8 0 000 16z" },
    { key: "reco", label: "Pra mim", icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" },
    { key: "config", label: "Config", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" },
  ];
  return (
    <div style={{
      position: "sticky", bottom: 0, left: 0, right: 0, height: 64,
      borderTop: "0.5px solid var(--color-border-tertiary, #e5e5e5)",
      display: "flex", alignItems: "center", justifyContent: "space-around",
      background: "var(--color-background-primary, #fff)", zIndex: 10,
    }}>
      {items.map(it => (
        <div key={it.key} onClick={() => onNavigate(it.key)} style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
          fontSize: 11, cursor: "pointer",
          color: active === it.key ? "#534AB7" : "var(--color-text-tertiary, #999)",
        }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d={it.icon} />
            {it.key === "explore" ? null : null}
          </svg>
          {it.label}
        </div>
      ))}
    </div>
  );
}

function HomeScreen({ books, onNavigate, onSelectBook, onAdd, statusFilter, setStatusFilter }) {
  const [search, setSearch] = useState("");
  const filtered = books.filter(b => {
    if (statusFilter && b.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return b.title.toLowerCase().includes(q) || b.authors?.join(" ").toLowerCase().includes(q) ||
        b.tropes?.some(t => t.includes(q)) || b.genres?.some(g => g.includes(q));
    }
    return true;
  });

  return (
    <div style={{ paddingBottom: 8 }}>
      <div style={{ padding: "0 20px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.5 }}>Minha estante</h1>
        <div onClick={onAdd} style={{
          width: 38, height: 38, borderRadius: "50%", background: "#534AB7",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        }}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </div>
      </div>
      <div style={{ margin: "0 20px 14px", position: "relative" }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary,#999)" strokeWidth={2} style={{ position: "absolute", left: 12, top: 11 }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por titulo, autor ou trope..."
          style={{
            width: "100%", padding: "10px 14px 10px 36px", borderRadius: 10,
            background: "var(--color-background-secondary,#f5f5f5)", border: "none",
            fontSize: 14, color: "var(--color-text-primary,#222)", outline: "none",
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 8, padding: "0 20px 14px", overflowX: "auto" }}>
        {[{ key: "", label: "Todos" }, { key: "lendo", label: "Lendo" }, { key: "quero ler", label: "Quero ler" }, { key: "lido", label: "Lido" }].map(f => (
          <div key={f.key} onClick={() => setStatusFilter(f.key)} style={{
            padding: "6px 16px", borderRadius: 20, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
            background: statusFilter === f.key ? "#EEEDFE" : "transparent",
            color: statusFilter === f.key ? "#3C3489" : "var(--color-text-secondary,#666)",
            border: `0.5px solid ${statusFilter === f.key ? "#AFA9EC" : "var(--color-border-tertiary,#ddd)"}`,
            fontWeight: statusFilter === f.key ? 500 : 400,
          }}>{f.label}</div>
        ))}
      </div>
      <div style={{ padding: "0 20px 6px", fontSize: 13, color: "var(--color-text-secondary,#666)" }}>
        {filtered.length} {filtered.length === 1 ? "livro" : "livros"} na estante
      </div>
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--color-text-tertiary,#999)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
          <div style={{ fontSize: 15, marginBottom: 4 }}>Sua estante esta vazia</div>
          <div style={{ fontSize: 13 }}>Toque no <strong>+</strong> pra adicionar seu primeiro livro</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, padding: "0 20px 20px" }}>
          {filtered.map(book => (
            <div key={book.id} onClick={() => onSelectBook(book)} style={{ cursor: "pointer", textAlign: "center" }}>
              <div style={{
                width: "100%", aspectRatio: "2/3", borderRadius: 10, position: "relative",
                background: book.cover ? `url(${book.cover}) center/cover` : getGradient(book.title),
                overflow: "hidden",
              }}>
                <StatusDot status={book.status} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, marginTop: 6, lineHeight: 1.3,
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {book.title}
              </div>
              <div style={{ fontSize: 11, color: "var(--color-text-tertiary,#999)", marginTop: 2 }}>
                {book.authors?.[0] || ""}
              </div>
              {book.genres?.[0] && (
                <div style={{ display: "flex", gap: 3, justifyContent: "center", marginTop: 4, flexWrap: "wrap" }}>
                  <TagPill label={book.genres[0]} color={GENRE_COLORS[book.genres[0]] || "purple"} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddBookScreen({ onBack, onSave, apiKey }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("quero ler");

  const doSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSelected(null);
    const r = await searchGoogleBooks(query);
    setResults(r);
    setLoading(false);
  };

  const doSave = async () => {
    if (!selected) return;
    let classification = { genres: [], tropes: [], summary: "" };
    if (apiKey) {
      setClassifying(true);
      classification = await classifyWithAI(apiKey, selected.title, selected.authors.join(", "), selected.description);
      setClassifying(false);
    }
    onSave({
      id: Date.now().toString(),
      googleId: selected.googleId,
      title: selected.title,
      authors: selected.authors,
      description: selected.description,
      cover: selected.cover,
      publishedDate: selected.publishedDate,
      pageCount: selected.pageCount,
      status,
      genres: classification.genres || [],
      tropes: classification.tropes || [],
      summary: classification.summary || "",
      rating: 0,
      addedAt: new Date().toISOString(),
    });
  };

  return (
    <div style={{ paddingBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 20px 16px" }}>
        <svg onClick={onBack} width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ cursor: "pointer" }}>
          <path d="M15 18l-6-6 6-6"/>
        </svg>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Adicionar livro</h1>
      </div>
      <div style={{ margin: "0 20px 16px", display: "flex", gap: 8 }}>
        <input value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && doSearch()}
          placeholder="Nome do livro ou autor..."
          style={{
            flex: 1, padding: "10px 14px", borderRadius: 10,
            background: "var(--color-background-secondary,#f5f5f5)", border: "none",
            fontSize: 14, color: "var(--color-text-primary,#222)", outline: "none",
          }}
        />
        <button onClick={doSearch} disabled={loading} style={{
          padding: "10px 18px", borderRadius: 10, background: "#534AB7", color: "white",
          border: "none", fontSize: 14, fontWeight: 500, cursor: "pointer", opacity: loading ? 0.6 : 1,
        }}>{loading ? "..." : "Buscar"}</button>
      </div>

      {results.length > 0 && !selected && (
        <div style={{ padding: "0 20px" }}>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary,#666)", marginBottom: 10 }}>
            {results.length} resultados encontrados
          </div>
          {results.map(r => (
            <div key={r.googleId} onClick={() => setSelected(r)} style={{
              display: "flex", gap: 12, padding: 12, marginBottom: 8,
              borderRadius: 12, border: "0.5px solid var(--color-border-tertiary,#ddd)",
              cursor: "pointer", background: "var(--color-background-primary,#fff)",
            }}>
              <div style={{
                width: 50, height: 75, borderRadius: 6, flexShrink: 0,
                background: r.cover ? `url(${r.cover}) center/cover` : getGradient(r.title),
              }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>{r.title}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary,#666)", marginTop: 2 }}>
                  {r.authors.join(", ")}
                </div>
                {r.publishedDate && (
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary,#999)", marginTop: 2 }}>
                    {r.publishedDate.substring(0, 4)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div style={{ padding: "0 20px" }}>
          <div style={{
            padding: 16, borderRadius: 12, border: "2px solid #534AB7",
            background: "var(--color-background-primary,#fff)", marginBottom: 16,
          }}>
            <div style={{ display: "flex", gap: 14 }}>
              <div style={{
                width: 70, height: 105, borderRadius: 8, flexShrink: 0,
                background: selected.cover ? `url(${selected.cover}) center/cover` : getGradient(selected.title),
              }} />
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>{selected.title}</div>
                <div style={{ fontSize: 13, color: "var(--color-text-secondary,#666)", marginTop: 4 }}>
                  {selected.authors.join(", ")}
                </div>
                {selected.pageCount > 0 && (
                  <div style={{ fontSize: 12, color: "var(--color-text-tertiary,#999)", marginTop: 4 }}>
                    {selected.pageCount} paginas
                  </div>
                )}
              </div>
            </div>
            {selected.description && (
              <div style={{
                fontSize: 13, color: "var(--color-text-secondary,#666)", marginTop: 12,
                lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical", overflow: "hidden",
              }}>{selected.description.replace(/<[^>]*>/g, "")}</div>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Status de leitura</div>
            <div style={{ display: "flex", gap: 8 }}>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <div key={key} onClick={() => setStatus(key)} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10, textAlign: "center",
                  fontSize: 13, cursor: "pointer", fontWeight: status === key ? 500 : 400,
                  background: status === key ? "#EEEDFE" : "transparent",
                  color: status === key ? "#3C3489" : "var(--color-text-secondary,#666)",
                  border: `0.5px solid ${status === key ? "#AFA9EC" : "var(--color-border-tertiary,#ddd)"}`,
                }}>{label}</div>
              ))}
            </div>
          </div>

          <button onClick={doSave} disabled={classifying} style={{
            width: "100%", padding: "14px", borderRadius: 12, border: "none",
            background: classifying ? "#AFA9EC" : "#534AB7", color: "white",
            fontSize: 15, fontWeight: 600, cursor: "pointer",
          }}>
            {classifying ? "Classificando com IA..." : "Salvar na estante"}
          </button>
          {classifying && (
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary,#999)", textAlign: "center", marginTop: 8 }}>
              Analisando sinopse e identificando tropes...
            </div>
          )}
        </div>
      )}

      {results.length === 0 && !loading && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--color-text-tertiary,#999)" }}>
          <div style={{ fontSize: 14 }}>Busque pelo nome do livro ou autor</div>
        </div>
      )}
    </div>
  );
}

function BookDetailScreen({ book, onBack, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(book.status);
  const [rating, setRating] = useState(book.rating || 0);
  const [customTropes, setCustomTropes] = useState(book.tropes || []);
  const [showAllTropes, setShowAllTropes] = useState(false);

  const handleSave = () => {
    onUpdate({ ...book, status, rating, tropes: customTropes });
    setEditing(false);
  };

  const toggleTrope = (trope) => {
    setCustomTropes(prev => prev.includes(trope) ? prev.filter(t => t !== trope) : [...prev, trope]);
  };

  return (
    <div style={{ paddingBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px 16px" }}>
        <svg onClick={onBack} width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ cursor: "pointer" }}>
          <path d="M15 18l-6-6 6-6"/>
        </svg>
        <div style={{ display: "flex", gap: 12 }}>
          <div onClick={() => setEditing(!editing)} style={{ fontSize: 13, color: "#534AB7", cursor: "pointer", fontWeight: 500 }}>
            {editing ? "Cancelar" : "Editar"}
          </div>
          <div onClick={() => { if (confirm("Remover este livro da estante?")) { onDelete(book.id); onBack(); } }}
            style={{ fontSize: 13, color: "var(--color-text-danger,#c00)", cursor: "pointer" }}>
            Remover
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, padding: "0 20px 20px" }}>
        <div style={{
          width: 110, height: 165, borderRadius: 12, flexShrink: 0,
          background: book.cover ? `url(${book.cover}) center/cover` : getGradient(book.title),
        }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.2, marginBottom: 4 }}>{book.title}</h2>
          <div style={{ fontSize: 14, color: "var(--color-text-secondary,#666)" }}>{book.authors?.join(", ")}</div>
          {book.publishedDate && (
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary,#999)", marginTop: 4 }}>
              {book.publishedDate.substring(0, 4)} {book.pageCount > 0 ? `· ${book.pageCount} pag.` : ""}
            </div>
          )}
          <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
            {[1, 2, 3, 4, 5].map(s => (
              <svg key={s} onClick={() => { if (editing) setRating(s === rating ? 0 : s); }} width={22} height={22}
                viewBox="0 0 24 24" fill={s <= rating ? "#EF9F27" : "none"}
                stroke={s <= rating ? "#EF9F27" : "var(--color-border-secondary,#ccc)"} strokeWidth={1.5}
                style={{ cursor: editing ? "pointer" : "default" }}>
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "0 20px 16px" }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Status</div>
        <div style={{ display: "flex", gap: 8 }}>
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <div key={key} onClick={() => editing && setStatus(key)} style={{
              flex: 1, padding: "8px 0", borderRadius: 10, textAlign: "center",
              fontSize: 13, cursor: editing ? "pointer" : "default",
              fontWeight: status === key ? 500 : 400,
              background: status === key ? "#EEEDFE" : "transparent",
              color: status === key ? "#3C3489" : "var(--color-text-secondary,#666)",
              border: `0.5px solid ${status === key ? "#AFA9EC" : "var(--color-border-tertiary,#ddd)"}`,
              opacity: editing ? 1 : (status === key ? 1 : 0.5),
            }}>{label}</div>
          ))}
        </div>
      </div>

      {book.summary && (
        <div style={{ padding: "0 20px 16px" }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Resumo da IA</div>
          <div style={{
            fontSize: 13, color: "var(--color-text-secondary,#666)", lineHeight: 1.5,
            fontStyle: "italic", padding: "10px 14px", borderRadius: 10,
            background: "var(--color-background-secondary,#f5f5f5)",
          }}>{book.summary}</div>
        </div>
      )}

      <div style={{ padding: "0 20px 16px" }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Generos</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(book.genres || []).map(g => (
            <TagPill key={g} label={g} color={GENRE_COLORS[g] || "purple"} />
          ))}
          {(!book.genres || book.genres.length === 0) && (
            <span style={{ fontSize: 13, color: "var(--color-text-tertiary,#999)" }}>Nenhum genero classificado</span>
          )}
        </div>
      </div>

      <div style={{ padding: "0 20px 16px" }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Tropes</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(editing ? (showAllTropes ? TROPES_LIST : [...new Set([...customTropes, ...TROPES_LIST.slice(0, 10)])] ) : customTropes).map(t => (
            <div key={t} onClick={() => editing && toggleTrope(t)} style={{
              fontSize: 11, padding: "4px 12px", borderRadius: 12, cursor: editing ? "pointer" : "default",
              background: customTropes.includes(t) ? (TROPE_COLORS[t] === "pink" ? "#FBEAF0" : TROPE_COLORS[t] === "coral" ? "#FAECE7" : TROPE_COLORS[t] === "teal" ? "#E1F5EE" : TROPE_COLORS[t] === "amber" ? "#FAEEDA" : TROPE_COLORS[t] === "gray" ? "#F1EFE8" : TROPE_COLORS[t] === "red" ? "#FCEBEB" : TROPE_COLORS[t] === "blue" ? "#E6F1FB" : "#EEEDFE") : "var(--color-background-secondary,#f5f5f5)",
              color: customTropes.includes(t) ? (TROPE_COLORS[t] === "pink" ? "#72243E" : TROPE_COLORS[t] === "coral" ? "#712B13" : TROPE_COLORS[t] === "teal" ? "#085041" : TROPE_COLORS[t] === "amber" ? "#633806" : TROPE_COLORS[t] === "gray" ? "#444441" : TROPE_COLORS[t] === "red" ? "#791F1F" : TROPE_COLORS[t] === "blue" ? "#0C447C" : "#3C3489") : "var(--color-text-tertiary,#999)",
              border: customTropes.includes(t) ? "none" : "0.5px solid var(--color-border-tertiary,#ddd)",
            }}>{t}</div>
          ))}
          {editing && !showAllTropes && (
            <div onClick={() => setShowAllTropes(true)} style={{
              fontSize: 11, padding: "4px 12px", borderRadius: 12, cursor: "pointer",
              color: "#534AB7", border: "0.5px dashed #AFA9EC",
            }}>+ ver todas</div>
          )}
        </div>
      </div>

      {book.description && (
        <div style={{ padding: "0 20px 16px" }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Sinopse</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary,#666)", lineHeight: 1.6 }}>
            {book.description.replace(/<[^>]*>/g, "")}
          </div>
        </div>
      )}

      {editing && (
        <div style={{ padding: "0 20px" }}>
          <button onClick={handleSave} style={{
            width: "100%", padding: "14px", borderRadius: 12, border: "none",
            background: "#534AB7", color: "white", fontSize: 15, fontWeight: 600, cursor: "pointer",
          }}>Salvar alteracoes</button>
        </div>
      )}
    </div>
  );
}

function ExploreScreen({ books, onSelectBook }) {
  const [selectedTropes, setSelectedTropes] = useState([]);
  const [selectedGenre, setSelectedGenre] = useState("");

  const allTropes = [...new Set(books.flatMap(b => b.tropes || []))].sort();
  const allGenres = [...new Set(books.flatMap(b => b.genres || []))].sort();

  const filtered = books.filter(b => {
    if (selectedGenre && !(b.genres || []).includes(selectedGenre)) return false;
    if (selectedTropes.length > 0 && !selectedTropes.every(t => (b.tropes || []).includes(t))) return false;
    return true;
  });

  const toggleTrope = (t) => setSelectedTropes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  return (
    <div style={{ paddingBottom: 8 }}>
      <div style={{ padding: "0 20px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Explorar</h1>
      </div>

      {books.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--color-text-tertiary,#999)" }}>
          <div style={{ fontSize: 15, marginBottom: 4 }}>Nada pra explorar ainda</div>
          <div style={{ fontSize: 13 }}>Adicione livros pra poder filtrar por tropes</div>
        </div>
      ) : (
        <>
          {allGenres.length > 0 && (
            <div style={{ padding: "0 20px 12px" }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Generos</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {allGenres.map(g => (
                  <div key={g} onClick={() => setSelectedGenre(selectedGenre === g ? "" : g)} style={{
                    padding: "6px 14px", borderRadius: 20, fontSize: 13, cursor: "pointer",
                    background: selectedGenre === g ? "#EEEDFE" : "transparent",
                    color: selectedGenre === g ? "#3C3489" : "var(--color-text-secondary,#666)",
                    border: `0.5px solid ${selectedGenre === g ? "#AFA9EC" : "var(--color-border-tertiary,#ddd)"}`,
                    fontWeight: selectedGenre === g ? 500 : 400,
                  }}>{g}</div>
                ))}
              </div>
            </div>
          )}

          {allTropes.length > 0 && (
            <div style={{ padding: "0 20px 16px" }}>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Tropes</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {allTropes.map(t => (
                  <div key={t} onClick={() => toggleTrope(t)} style={{
                    padding: "5px 12px", borderRadius: 16, fontSize: 12, cursor: "pointer",
                    background: selectedTropes.includes(t) ? "#EEEDFE" : "var(--color-background-secondary,#f5f5f5)",
                    color: selectedTropes.includes(t) ? "#3C3489" : "var(--color-text-secondary,#666)",
                    border: selectedTropes.includes(t) ? "0.5px solid #AFA9EC" : "0.5px solid transparent",
                    fontWeight: selectedTropes.includes(t) ? 500 : 400,
                  }}>{t}</div>
                ))}
              </div>
            </div>
          )}

          <div style={{
            padding: "0 20px", borderTop: "0.5px solid var(--color-border-tertiary,#e5e5e5)",
            paddingTop: 16,
          }}>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary,#666)", marginBottom: 12 }}>
              {filtered.length} {filtered.length === 1 ? "livro encontrado" : "livros encontrados"}
              {selectedTropes.length > 0 && ` com ${selectedTropes.join(" + ")}`}
            </div>
            {filtered.map(book => (
              <div key={book.id} onClick={() => onSelectBook(book)} style={{
                display: "flex", gap: 12, padding: 12, marginBottom: 8,
                borderRadius: 12, border: "0.5px solid var(--color-border-tertiary,#ddd)",
                cursor: "pointer", background: "var(--color-background-primary,#fff)",
              }}>
                <div style={{
                  width: 50, height: 75, borderRadius: 6, flexShrink: 0,
                  background: book.cover ? `url(${book.cover}) center/cover` : getGradient(book.title),
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{book.title}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-secondary,#666)", marginTop: 2 }}>
                    {book.authors?.join(", ")}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                    {(book.tropes || []).slice(0, 3).map(t => (
                      <TagPill key={t} label={t} color={TROPE_COLORS[t] || "purple"} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RecoScreen({ books, onSelectBook }) {
  const readBooks = books.filter(b => b.status === "lido" || b.rating >= 3);

  if (books.length < 2) {
    return (
      <div style={{ paddingBottom: 8 }}>
        <div style={{ padding: "0 20px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
          </svg>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>Pra mim</h1>
        </div>
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--color-text-tertiary,#999)" }}>
          <div style={{ fontSize: 15, marginBottom: 4 }}>Adicione mais livros!</div>
          <div style={{ fontSize: 13 }}>Preciso de pelo menos 2 livros pra gerar recomendacoes</div>
        </div>
      </div>
    );
  }

  const tropeCounts = {};
  books.forEach(b => (b.tropes || []).forEach(t => { tropeCounts[t] = (tropeCounts[t] || 0) + 1; }));
  const topTropes = Object.entries(tropeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const getSimilarity = (a, b) => {
    const at = new Set(a.tropes || []);
    const bt = new Set(b.tropes || []);
    const intersection = [...at].filter(x => bt.has(x)).length;
    const union = new Set([...at, ...bt]).size;
    return union === 0 ? 0 : Math.round((intersection / union) * 100);
  };

  const recommendations = [];
  books.forEach(bookA => {
    books.forEach(bookB => {
      if (bookA.id === bookB.id) return;
      const sim = getSimilarity(bookA, bookB);
      if (sim > 30) {
        const existing = recommendations.find(r => r.book.id === bookB.id);
        if (!existing || existing.similarity < sim) {
          if (existing) existing.similarity = sim;
          else recommendations.push({ book: bookB, similarity: sim, basedOn: bookA });
        }
      }
    });
  });
  recommendations.sort((a, b) => b.similarity - a.similarity);

  return (
    <div style={{ paddingBottom: 8 }}>
      <div style={{ padding: "0 20px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
        </svg>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Pra mim</h1>
      </div>

      {topTropes.length > 0 && (
        <div style={{ padding: "0 20px 16px" }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Suas tropes favoritas</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {topTropes.map(([trope, count]) => (
              <div key={trope} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 16, background: "#EEEDFE",
              }}>
                <span style={{ fontSize: 12, color: "#3C3489" }}>{trope}</span>
                <span style={{
                  fontSize: 10, padding: "1px 6px", borderRadius: 8,
                  background: "#AFA9EC", color: "#26215C",
                }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recommendations.length > 0 ? (
        <div style={{ padding: "0 20px" }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Livros semelhantes na sua estante</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary,#666)", marginBottom: 12 }}>
            Baseado nas tropes em comum
          </div>
          {recommendations.slice(0, 6).map(({ book, similarity, basedOn }) => (
            <div key={book.id} onClick={() => onSelectBook(book)} style={{
              display: "flex", gap: 12, padding: 14, marginBottom: 10,
              borderRadius: 12, border: "0.5px solid var(--color-border-tertiary,#ddd)",
              cursor: "pointer", background: "var(--color-background-primary,#fff)",
            }}>
              <div style={{
                width: 56, height: 84, borderRadius: 8, flexShrink: 0,
                background: book.cover ? `url(${book.cover}) center/cover` : getGradient(book.title),
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{book.title}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary,#666)", marginTop: 2 }}>
                  {book.authors?.join(", ")}
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary,#999)", marginTop: 4, fontStyle: "italic" }}>
                  Parecido com "{basedOn.title}"
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                  {(book.tropes || []).slice(0, 3).map(t => (
                    <TagPill key={t} label={t} color={TROPE_COLORS[t] || "purple"} />
                  ))}
                </div>
                <div style={{ height: 4, borderRadius: 2, background: "var(--color-background-secondary,#f0f0f0)", marginTop: 8 }}>
                  <div style={{ height: "100%", borderRadius: 2, background: "#534AB7", width: `${similarity}%` }} />
                </div>
                <div style={{ fontSize: 11, color: "#534AB7", fontWeight: 500, marginTop: 3 }}>
                  {similarity}% compativel
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "20px", color: "var(--color-text-tertiary,#999)" }}>
          <div style={{ fontSize: 13 }}>Adicione mais livros com tropes parecidas pra ver recomendacoes</div>
        </div>
      )}
    </div>
  );
}

function ConfigScreen({ apiKey, setApiKey }) {
  const [input, setInput] = useState(apiKey);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const handleSave = () => {
    setApiKey(input);
    localStorage.setItem("minha-estante-api-key", input);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const maskedValue = input ? input.slice(0, 7) + "\u2022".repeat(Math.max(0, input.length - 11)) + input.slice(-4) : "";

  return (
    <div style={{ paddingBottom: 20 }}>
      <div style={{ padding: "0 20px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Configuracoes</h1>
      </div>

      <div style={{ padding: "0 20px" }}>
        <div style={{
          padding: 16, borderRadius: 12, background: "var(--color-background-secondary,#f5f5f5)",
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Chave da API Anthropic</div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary,#666)", marginBottom: 12, lineHeight: 1.5 }}>
            Necessaria pra classificar livros automaticamente por tropes usando IA. Sua chave fica salva apenas no seu dispositivo.
          </div>
          <div style={{ position: "relative", marginBottom: 6 }}>
            <textarea
              value={showKey ? input : maskedValue}
              onChange={e => { if (showKey) setInput(e.target.value); }}
              onFocus={() => setShowKey(true)}
              placeholder="Cole sua chave aqui (sk-ant-...)"
              rows={3}
              style={{
                width: "100%", padding: "12px 14px", borderRadius: 10,
                background: "var(--color-background-primary,#fff)",
                border: "0.5px solid var(--color-border-tertiary,#ddd)",
                fontSize: 13, outline: "none", resize: "none",
                color: "var(--color-text-primary,#222)",
                fontFamily: "var(--font-mono, monospace)",
                lineHeight: 1.5, wordBreak: "break-all",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div onClick={() => setShowKey(!showKey)} style={{
              display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
              fontSize: 13, color: "#534AB7",
            }}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                {showKey ? (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </>
                ) : (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </>
                )}
              </svg>
              {showKey ? "Esconder chave" : "Mostrar chave"}
            </div>
          </div>
          <button onClick={handleSave} style={{
            width: "100%", padding: "12px", borderRadius: 10, border: "none",
            background: saved ? "#639922" : "#534AB7", color: "white",
            fontSize: 14, fontWeight: 500, cursor: "pointer",
          }}>{saved ? "Salvo!" : "Salvar chave"}</button>
        </div>

        <div style={{
          padding: 16, borderRadius: 12, background: "var(--color-background-secondary,#f5f5f5)",
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Sobre o app</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary,#666)", lineHeight: 1.6 }}>
            Minha Estante e sua biblioteca pessoal inteligente. Adicione livros, classifique por tropes com ajuda de IA, e descubra livros parecidos na sua colecao.
          </div>
        </div>

        <div style={{
          padding: 16, borderRadius: 12, border: "0.5px solid var(--color-border-danger,#f5c1c1)",
          background: "var(--color-background-danger,#fcebeb)",
        }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, color: "var(--color-text-danger,#a32d2d)" }}>
            Limpar dados
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-secondary,#666)", marginBottom: 10 }}>
            Remove todos os livros da sua estante. Esta acao nao pode ser desfeita.
          </div>
          <button onClick={() => {
            if (confirm("Tem certeza? Todos os livros serao removidos.")) {
              localStorage.removeItem(STORAGE_KEY);
              window.location.reload();
            }
          }} style={{
            padding: "8px 20px", borderRadius: 8, border: "none",
            background: "var(--color-text-danger,#a32d2d)", color: "white",
            fontSize: 13, cursor: "pointer",
          }}>Limpar tudo</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [books, setBooks] = useState(loadBooks);
  const [screen, setScreen] = useState("home");
  const [selectedBook, setSelectedBook] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [apiKey, setApiKey] = useState(() => (typeof window !== "undefined" ? localStorage.getItem("minha-estante-api-key") : "") || "");
  const scrollRef = useRef(null);

  useEffect(() => { saveBooks(books); }, [books]);
  useEffect(() => { scrollRef.current?.scrollTo(0, 0); }, [screen, selectedBook]);

  const navigate = (s) => { setScreen(s); setSelectedBook(null); };

  const addBook = (book) => {
    setBooks(prev => [book, ...prev]);
    setScreen("home");
  };

  const updateBook = (updated) => {
    setBooks(prev => prev.map(b => b.id === updated.id ? updated : b));
    setSelectedBook(updated);
  };

  const deleteBook = (id) => {
    setBooks(prev => prev.filter(b => b.id !== id));
  };

  const activeTab = screen === "add" ? "home" : screen === "detail" ? "home" : screen;

  return (
    <div style={{
      maxWidth: 430, margin: "0 auto", fontFamily: "'Anthropic Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      minHeight: "100vh", display: "flex", flexDirection: "column",
      background: "var(--color-background-primary, #fff)",
      color: "var(--color-text-primary, #222)",
    }}>
      <div ref={scrollRef} style={{ flex: 1, paddingTop: 16, paddingBottom: 64, overflowY: "auto" }}>
        {screen === "home" && (
          <HomeScreen books={books} onNavigate={navigate}
            onSelectBook={(b) => { setSelectedBook(b); setScreen("detail"); }}
            onAdd={() => setScreen("add")}
            statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          />
        )}
        {screen === "add" && (
          <AddBookScreen onBack={() => setScreen("home")} onSave={addBook} apiKey={apiKey} />
        )}
        {screen === "detail" && selectedBook && (
          <BookDetailScreen book={selectedBook} onBack={() => setScreen("home")}
            onUpdate={updateBook} onDelete={deleteBook}
          />
        )}
        {screen === "explore" && (
          <ExploreScreen books={books} onSelectBook={(b) => { setSelectedBook(b); setScreen("detail"); }} />
        )}
        {screen === "reco" && (
          <RecoScreen books={books} onSelectBook={(b) => { setSelectedBook(b); setScreen("detail"); }} />
        )}
        {screen === "config" && (
          <ConfigScreen apiKey={apiKey} setApiKey={setApiKey} />
        )}
      </div>
      <BottomNav active={activeTab} onNavigate={navigate} />
    </div>
  );
}
