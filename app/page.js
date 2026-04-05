"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "../lib/supabase";
import { getGradient, filterBooks, buildRecommendations, normalizeBookRow } from "../lib/utils";

const supabaseAuth = createClient();


const STATUS_COLORS = { "quero ler": "#378ADD", lido: "#888780" };
const STATUS_LABELS = { "quero ler": "Quero ler", lido: "Lido" };


// ─── Supabase: estante pessoal ────────────────────────────────────────────────

async function fetchBooks(userId) {
  const { data, error } = await supabaseAuth
    .from("bookcase")
    .select("id, status, rating, added_at, books(google_id, title, authors, cover, description, page_count, genres, tropes, summary)")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });
  if (error) { console.error("fetchBooks error:", error); return []; }
  return data.map(normalizeBookRow);
}

async function insertBook({ googleId, status, rating }, userId) {
  let bookId;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 800));
    const { data: catalogRow } = await supabaseAuth
      .from("books_catalog")
      .select("book_id")
      .eq("google_id", googleId)
      .maybeSingle();
    bookId = catalogRow?.book_id;
    if (bookId) break;
  }

  if (!bookId) {
    console.error("insertBook: book_id não encontrado em books_catalog para", googleId);
    return null;
  }

  const { data: inserted, error } = await supabaseAuth
    .from("bookcase")
    .insert({ user_id: userId, book_id: bookId, status, rating, added_at: new Date().toISOString() })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return null; // livro já está na estante
    console.error("insertBook error:", error); return null;
  }

  // Incrementa save_count em books (fire-and-forget)
  supabaseAuth.from("books").select("save_count").eq("id", bookId).single()
    .then(({ data: bk }) =>
      supabaseAuth.from("books").update({ save_count: (bk?.save_count || 0) + 1 }).eq("id", bookId)
        .then(({ error: e }) => { if (e) console.error("save_count error:", e); })
    );

  return inserted?.id;
}

async function updateBookInDb(book, userId) {
  const { error } = await supabaseAuth
    .from("bookcase")
    .update({ status: book.status, rating: book.rating })
    .eq("id", book.id)
    .eq("user_id", userId);
  if (error) console.error("updateBook error:", error);
}

async function updateRatingAvgInDb(googleId) {
  const { data: catalogRow } = await supabaseAuth
    .from("books_catalog")
    .select("book_id")
    .eq("google_id", googleId)
    .maybeSingle();
  const bookId = catalogRow?.book_id;
  if (!bookId) return;
  const { data: ratings } = await supabaseAuth
    .from("bookcase")
    .select("rating")
    .eq("book_id", bookId)
    .gt("rating", 0);
  if (!ratings || ratings.length === 0) return;
  const avg = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
  await supabaseAuth
    .from("books")
    .update({ rating_avg: avg, rating_count: ratings.length })
    .eq("id", bookId);
}

async function deleteBookFromDb(id, userId) {
  const { error } = await supabaseAuth.from("bookcase").delete().eq("id", id).eq("user_id", userId);
  if (error) console.error("deleteBook error:", error);
}

// ─── Supabase: catálogo global ────────────────────────────────────────────────

async function getClassificationForBook(googleId) {
  const { data: catalogRow } = await supabaseAuth
    .from("books_catalog")
    .select("book_id")
    .eq("google_id", googleId)
    .maybeSingle();

  if (!catalogRow?.book_id) return null;

  const { data: book } = await supabaseAuth
    .from("books")
    .select("canonical_key, genres, tropes, summary, view_count")
    .eq("id", catalogRow.book_id)
    .maybeSingle();

  if (!book) return null;

  supabaseAuth.from("books")
    .update({ view_count: (book.view_count || 0) + 1 })
    .eq("id", catalogRow.book_id)
    .then(({ error: e }) => { if (e) console.error("view_count error:", e); });

  return { canonical_key: book.canonical_key, genres: book.genres || [], tropes: book.tropes || [], summary: book.summary || "" };
}

async function saveCanonicalBook(googleId, bookData, classification) {
  let bookId;

  const entry = {
    canonical_key: classification.canonical_key || "",
    google_id: googleId,
    title: bookData.title,
    authors: bookData.authors,
    cover: bookData.cover || null,
    description: bookData.description || null,
    page_count: bookData.pageCount || 0,
    genres: classification.genres || [],
    tropes: classification.tropes || [],
    summary: classification.summary || null,
  };

  console.log("[saveCanonicalBook] inserting into books:", entry);

  const { data: inserted, error } = await supabaseAuth
    .from("books")
    .insert(entry)
    .select("id")
    .single();

  if (error) {
    console.error("[saveCanonicalBook] INSERT error — code:", error.code, "message:", error.message, "details:", error.details, "hint:", error.hint);
    if (error.code === "23505") {
      const { data: existing } = await supabaseAuth
        .from("books")
        .select("id, google_ids")
        .eq("canonical_key", classification.canonical_key)
        .maybeSingle();
      bookId = existing?.id;
      if (bookId && googleId) {
        const currentIds = existing?.google_ids || [];
        if (!currentIds.includes(googleId)) {
          supabaseAuth.from("books")
            .update({ google_ids: [...currentIds, googleId] })
            .eq("id", bookId)
            .then(({ error: e }) => { if (e) console.error("google_ids append error:", e); });
        }
      }
    } else {
      return;
    }
  } else {
    bookId = inserted?.id;
    console.log("[saveCanonicalBook] INSERT ok, bookId:", bookId);
  }

  if (!bookId) { console.error("[saveCanonicalBook] bookId is null, skipping books_catalog update"); return; }

  const { error: updateErr } = await supabaseAuth
    .from("books_catalog")
    .update({ book_id: bookId })
    .eq("google_id", googleId);
  if (updateErr) console.error("[saveCanonicalBook] UPDATE books_catalog error — code:", updateErr.code, "message:", updateErr.message);
  else console.log("[saveCanonicalBook] books_catalog.book_id updated for", googleId);
}

// ─── Google Books ─────────────────────────────────────────────────────────────

async function searchGoogleBooks(query, searchType = "title") {
  try {
    const key = process.env.NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY;
    const prefixedQuery = searchType === "title" ? "intitle:" + query : searchType === "author" ? "inauthor:" + query : query;
    const base = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(prefixedQuery)}&key=${key}`;

    const [resPt, resAll] = await Promise.all([
      fetch(`${base}&langRestrict=pt&maxResults=20`),
      fetch(`${base}&maxResults=20`),
    ]);
    const [dataPt, dataAll] = await Promise.all([resPt.json(), resAll.json()]);

    const norm = str => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s/g, "");
    const normTitle = str => str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\([^)]*\)/g, "").replace(/\bvol\.?\b/g, "").replace(/[0-9]/g, "").replace(/[^\w]/g, "").replace(/\s/g, "");

    const parseItems = (items, isPt) => (items || []).map(item => {
      const v = item.volumeInfo;
      const isbn13 = v.industryIdentifiers?.find(i => i.type === "ISBN_13")?.identifier || null;
      return {
        googleId: item.id,
        title: v.title || "",
        authors: v.authors || [],
        description: v.description || "",
        cover: v.imageLinks?.thumbnail?.replace("http:", "https:") || null,
        publishedDate: v.publishedDate || "",
        pageCount: v.pageCount || 0,
        isbn: isbn13,
        isPt: isPt || ["pt", "pt-BR"].includes(v.language),
      };
    });

    const all = [...parseItems(dataPt.items, true), ...parseItems(dataAll.items, false)];

    // Filtra pageCount ausente ou menor que 50
    const filtered = all.filter(b => b.pageCount >= 50);

    // Deduplicação dupla: primeiro por ISBN-13, depois por título normalizado+autor normalizado
    const byIsbn = new Map();
    const byTitleAuthor = new Map();
    for (const book of filtered) {
      if (book.isbn) {
        const existing = byIsbn.get(book.isbn);
        if (!existing || book.pageCount > existing.pageCount) byIsbn.set(book.isbn, book);
      } else {
        const taKey = normTitle(book.title) + norm(book.authors[0] || "");
        const existing = byTitleAuthor.get(taKey);
        if (!existing || book.pageCount > existing.pageCount) byTitleAuthor.set(taKey, book);
      }
    }
    // Remove do byTitleAuthor entradas que duplicam um ISBN já presente
    for (const book of byIsbn.values()) {
      const taKey = normTitle(book.title) + norm(book.authors[0] || "");
      byTitleAuthor.delete(taKey);
    }
    const deduped = [...byIsbn.values(), ...byTitleAuthor.values()];

    const nq = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const stopwords = new Set(["de","do","da","dos","das","e","o","a","os","as","em","por","para","com","um","uma","the","of","and","in","to","a"]);
    const queryWords = nq.split(/\s+/).filter(w => w.length > 3 && !stopwords.has(w));

    // Detecta se algum resultado tem autor que bate com palavra da query
    const authorMatchWords = new Set();
    for (const book of deduped) {
      const na = book.authors.join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      for (const w of queryWords) {
        if (na.includes(w)) authorMatchWords.add(w);
      }
    }

    const score = book => {
      const nt = book.title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const na = book.authors.join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      let s = 0;
      if (nt === nq) s += 40;
      else if (nt.startsWith(nq)) s += 30;
      else if (nt.includes(nq)) s += 20;
      else if (na.includes(nq)) s += 10;
      // Penaliza livros "sobre" o tema que não são o livro em si
      const authorHasQuery = queryWords.some(w => na.includes(w));
      if (!authorHasQuery && nt.includes(nq) && nt !== nq && !nt.startsWith(nq)) s -= 15;
      // Penaliza resultados cujo autor não bate com palavras de autor detectadas na query
      if (authorMatchWords.size > 0 && ![...authorMatchWords].some(w => na.includes(w))) s -= 10;
      if (book.isPt) s += 8;
      if (book.cover) s += 5;
      if (book.description.length > 100) s += 3;
      return s;
    };

    // Busca engajamento e qualidade do catálogo para os resultados encontrados
    const googleIds = deduped.map(b => b.googleId);
    const { data: catalogRows } = await supabaseAuth
      .from("books_catalog")
      .select("google_id, book_id, view_count, save_count, quality_checked, is_spam, quality_score")
      .in("google_id", googleIds);
    const catalogMap = new Map((catalogRows || []).map(r => [r.google_id, r]));

    // Dedup adicional por book_id: se dois google_ids apontam para o mesmo book, mantém só o primeiro
    const seenBookIds = new Set();
    const dedupedByBook = deduped.filter(b => {
      const bookId = catalogMap.get(b.googleId)?.book_id;
      if (!bookId) return true;
      if (seenBookIds.has(bookId)) return false;
      seenBookIds.add(bookId);
      return true;
    });

    // Dispara análise de qualidade em background para livros ainda não verificados
    for (const book of dedupedByBook) {
      const entry = catalogMap.get(book.googleId);
      if ((!entry || !entry.quality_checked) && book.googleId && book.title && book.title.trim().length > 0) {
        fetch("/api/quality", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: book.title, authors: book.authors.join(", "), description: book.description, pageCount: book.pageCount }),
        })
          .then(r => r.json())
          .then(({ is_spam, quality_score }) =>
            supabaseAuth.from("books_catalog").upsert(
              {
                google_id: book.googleId,
                title: book.title,
                authors: JSON.stringify(book.authors),
                description: book.description || null,
                cover: book.cover || null,
                published_date: book.publishedDate || null,
                page_count: book.pageCount || 0,
                quality_checked: true,
                is_spam: is_spam ?? false,
                quality_score: quality_score ?? 5,
              },
              { onConflict: "google_id" }
            ).then(({ error }) => { if (error) console.error("quality upsert error:", error); })
          )
          .catch(e => console.error("quality bg error:", e));
      }
    }

    const totalScore = book => {
      const entry = catalogMap.get(book.googleId);
      const engagement = entry ? (entry.view_count || 0) + (entry.save_count || 0) * 2 : 0;
      const quality = entry?.quality_checked ? (entry.quality_score || 0) : 0;
      const spamPenalty = entry?.is_spam ? 50 : 0;
      return score(book) + engagement + quality - spamPenalty;
    };

    return dedupedByBook
      .filter(b => {
        const entry = catalogMap.get(b.googleId);
        return !(entry?.is_spam && (entry?.quality_score ?? 10) < 3);
      })
      .sort((a, b) => totalScore(b) - totalScore(a))
      .slice(0, 15);
  } catch { return []; }
}

// ─── Claude AI ────────────────────────────────────────────────────────────────

async function classifyWithAI(title, authors, description) {
  try {
    const res = await fetch("/api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, authors, description }),
    });
    return await res.json();
  } catch(e) {
    console.error("AI classification error:", e);
    return { genres: [], tropes: [], summary: "" };
  }
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

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

const TAG_COLOR_STYLES = {
  purple: { bg: "#EEEDFE", text: "#3C3489" },
  pink: { bg: "#FBEAF0", text: "#72243E" },
  coral: { bg: "#FAECE7", text: "#712B13" },
  teal: { bg: "#E1F5EE", text: "#085041" },
  amber: { bg: "#FAEEDA", text: "#633806" },
  blue: { bg: "#E6F1FB", text: "#0C447C" },
  gray: { bg: "#F1EFE8", text: "#444441" },
  red: { bg: "#FCEBEB", text: "#791F1F" },
};

function TagPill({ label, color = "purple", onClick }) {
  const c = TAG_COLOR_STYLES[color] || TAG_COLOR_STYLES.purple;
  return (
    <span onClick={onClick} style={{ fontSize: 11, padding: "8px 10px", borderRadius: 12, background: c.bg, color: c.text, whiteSpace: "nowrap", display: "inline-block", minHeight: 30, boxSizing: "border-box", cursor: onClick ? "pointer" : "default" }}>
      {label}
    </span>
  );
}

function StatusDot({ status }) {
  return (
    <div style={{
      position: "absolute", top: 6, right: 6, width: 10, height: 10,
      borderRadius: "50%", background: STATUS_COLORS[status] || "#888",
      border: "2px solid rgba(255,255,255,0.8)",
    }} />
  );
}

function TropeSkeleton() {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {[80, 110, 90, 100, 75].map((w, i) => (
        <div key={i} style={{
          height: 24, width: w, borderRadius: 12,
          background: "linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%)",
          backgroundSize: "200% 100%",
          animation: "shimmer 1.4s infinite",
        }} />
      ))}
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
    </div>
  );
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────

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
      borderTop: "0.5px solid #e5e5e5", display: "flex", alignItems: "center",
      justifyContent: "space-around", background: "#fff", zIndex: 10,
    }}>
      {items.map(it => (
        <div key={it.key} onClick={() => onNavigate(it.key)} style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
          fontSize: 11, cursor: "pointer",
          color: active === it.key ? "#534AB7" : "#999",
        }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d={it.icon} />
          </svg>
          {it.label}
        </div>
      ))}
    </div>
  );
}

// ─── SearchInput ──────────────────────────────────────────────────────────────

function SearchInput({ value, onChange, onSearch, placeholder }) {
  const [open, setOpen] = useState(false);
  const suppressRef = useRef(false);
  const term = value.trim();
  const showDropdown = open && term.length > 0;

  const options = [
    { icon: "📖", label: "como título", type: "title" },
    { icon: "✍️", label: "como autor", type: "author" },
    { icon: "✨", label: "como trope", type: "trope" },
    { icon: "🏷️", label: "como gênero", type: "genre" },
  ];

  return (
    <div style={{ position: "relative", flex: 1 }}>
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth={2}
        style={{ position: "absolute", left: 12, top: 11, zIndex: 1 }}>
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input
        value={value}
        onChange={e => { setOpen(true); onChange(e.target.value); }}
        onKeyDown={e => { if (e.key === "Enter" && term) { suppressRef.current = true; setOpen(false); onSearch(term, "title"); } }}
        placeholder={placeholder}
        style={{ width: "100%", padding: "10px 14px 10px 36px", borderRadius: 10, background: "#f5f5f5", border: "none", fontSize: 14, outline: "none" }}
      />
      {showDropdown && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
          background: "#fff", border: "0.5px solid #e5e5e5", borderRadius: 10,
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)", zIndex: 20,
        }}>
          {options.map((opt, i) => (
            <div
              key={opt.type}
              onMouseDown={() => {
                if (suppressRef.current) { suppressRef.current = false; return; }
                setOpen(false);
                onSearch(term, opt.type);
              }}
              style={{
                padding: "12px 16px", fontSize: 14, cursor: "pointer",
                borderBottom: i < options.length - 1 ? "0.5px solid #f0f0f0" : "none",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#f9f9f9"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              {opt.icon} <strong>"{term}"</strong> — {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Home Screen ──────────────────────────────────────────────────────────────

function HomeScreen({ books, loading, onSelectBook, onSearch, statusFilter, setStatusFilter, onGenreClick, onTropeClick }) {
  const [search, setSearch] = useState("");
  const filtered = filterBooks(books, { statusFilter, search });

  return (
    <div style={{ paddingBottom: 8 }}>
      <div style={{ padding: "0 20px 14px" }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, marginBottom: 12, fontFamily: "'Abril Fatface', cursive" }}>O que você quer ler hoje?</h1>
        <SearchInput
          value={search}
          onChange={text => setSearch(text)}
          onSearch={(term, searchType) => onSearch(term, searchType)}
          placeholder="Buscar por titulo, autor ou trope..."
        />
      </div>
      <div style={{ display: "flex", gap: 8, padding: "0 20px 14px", overflowX: "auto" }}>
        {[{ key: "", label: "Todos" }, { key: "lendo", label: "Lendo" }, { key: "quero ler", label: "Quero ler" }, { key: "lido", label: "Lido" }].map(f => (
          <div key={f.key} onClick={() => setStatusFilter(f.key)} style={{
            padding: "6px 16px", borderRadius: 20, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
            background: statusFilter === f.key ? "#EEEDFE" : "transparent",
            color: statusFilter === f.key ? "#3C3489" : "#666",
            border: `0.5px solid ${statusFilter === f.key ? "#AFA9EC" : "#ddd"}`,
            fontWeight: statusFilter === f.key ? 500 : 400,
          }}>{f.label}</div>
        ))}
      </div>
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "#999" }}>
          <div style={{ fontSize: 14 }}>Carregando sua estante...</div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "#999" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
          <div style={{ fontSize: 15, marginBottom: 4 }}>Sua estante esta vazia</div>
          <div style={{ fontSize: 13 }}>Toque no <strong>+</strong> pra adicionar seu primeiro livro</div>
        </div>
      ) : (
        <>
          <div style={{ padding: "0 20px 6px", fontSize: 13, color: "#666" }}>
            {filtered.length} {filtered.length === 1 ? "livro" : "livros"} na estante
          </div>
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
                <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{book.authors?.[0] || ""}</div>
                {book.genres?.[0] && (
                  <div style={{ display: "flex", gap: 3, justifyContent: "center", marginTop: 4, flexWrap: "wrap" }}>
                    <TagPill label={book.genres[0]} color={GENRE_COLORS[book.genres[0]] || "purple"} onClick={onGenreClick ? (e) => { e.stopPropagation(); onGenreClick(book.genres[0]); } : undefined} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Book Detail Screen ───────────────────────────────────────────────────────

function BookDetailScreen({ book, onBack, onUpdate, onDelete, userId, onTropeClick }) {
  const [rating, setRating] = useState(book.rating || 0);
  const [globalRating, setGlobalRating] = useState(null);

  useEffect(() => {
    if (!book.googleId) return;
    (async () => {
      const { data: catalogRow } = await supabaseAuth
        .from("books_catalog")
        .select("book_id")
        .eq("google_id", book.googleId)
        .maybeSingle();
      if (!catalogRow?.book_id) return;
      const { data: bk } = await supabaseAuth
        .from("books")
        .select("rating_avg, rating_count")
        .eq("id", catalogRow.book_id)
        .maybeSingle();
      if (bk && bk.rating_count > 0) {
        setGlobalRating({ avg: bk.rating_avg, count: bk.rating_count });
      }
    })();
  }, [book.googleId]);

  useEffect(() => {
    if (book.genres && book.genres.length > 0) return;
    if (!book.googleId) return;

    (async () => {
      const cached = await getClassificationForBook(book.googleId);
      const genres = cached ? (cached.genres || []) : [];
      if (genres.length > 0) {
        onUpdate({ ...book, genres, tropes: cached.tropes || [], summary: cached.summary || "" });
        return;
      }
      const result = await classifyWithAI(book.title, book.authors.join(", "), book.description);
      await saveCanonicalBook(book.googleId, book, result);
      onUpdate({ ...book, genres: result.genres || [], tropes: result.tropes || [], summary: result.summary || "" });
    })();
  }, [book.id]);

  return (
    <div style={{ paddingBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px 16px" }}>
        <svg onClick={onBack} width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ cursor: "pointer" }}>
          <path d="M15 18l-6-6 6-6"/>
        </svg>
        <div onClick={() => { if (confirm("Remover este livro da estante?")) { onDelete(book.id); onBack(); } }}
          style={{ fontSize: 13, color: "#c00", cursor: "pointer" }}>
          Remover
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, padding: "0 20px 20px" }}>
        <div style={{
          width: 110, height: 165, borderRadius: 12, flexShrink: 0,
          background: book.cover ? `url(${book.cover}) center/cover` : getGradient(book.title),
        }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.2, marginBottom: 4 }}>{book.title}</h2>
          <div style={{ fontSize: 14, color: "#666" }}>{book.authors?.join(", ")}</div>
          {book.publishedDate && (
            <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
              {book.publishedDate.substring(0, 4)} {book.pageCount > 0 ? `· ${book.pageCount} pag.` : ""}
            </div>
          )}
          <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
            {[1, 2, 3, 4, 5].map(s => (
              <svg key={s} onClick={() => {
                const newRating = s === rating ? 0 : s;
                setRating(newRating);
                updateBookInDb({ ...book, rating: newRating }, userId);
                onUpdate({ ...book, rating: newRating });
                if (book.googleId) updateRatingAvgInDb(book.googleId).catch(() => {});
              }} width={22} height={22}
                viewBox="0 0 24 24" fill={s <= rating ? "#EF9F27" : "none"}
                stroke={s <= rating ? "#EF9F27" : "#ccc"} strokeWidth={1.5}
                style={{ cursor: "pointer" }}>
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            ))}
          </div>
          {globalRating && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6 }}>
              <span style={{ fontSize: 12, color: "#666", fontWeight: 500 }}>{globalRating.avg.toFixed(1)}</span>
              <div style={{ display: "flex", gap: 1 }}>
                {[1, 2, 3, 4, 5].map(s => (
                  <svg key={s} width={12} height={12} viewBox="0 0 24 24"
                    fill={s <= Math.round(globalRating.avg) ? "#EF9F27" : "none"}
                    stroke={s <= Math.round(globalRating.avg) ? "#EF9F27" : "#ccc"}
                    strokeWidth={1.5}>
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                  </svg>
                ))}
              </div>
              <span style={{ fontSize: 11, color: "#999" }}>· {globalRating.count} {globalRating.count === 1 ? "avaliação" : "avaliações"}</span>
            </div>
          )}
        </div>
      </div>

      {book.id && (
        <div style={{ padding: "0 20px 16px" }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Status</div>
          <div style={{ display: "flex", gap: 8 }}>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <div key={key} onClick={() => {
                if (key !== book.status) {
                  updateBookInDb({ ...book, status: key }, userId);
                  onUpdate({ ...book, status: key });
                }
              }} style={{
                flex: 1, padding: "8px 0", borderRadius: 10, textAlign: "center", fontSize: 13,
                cursor: "pointer", fontWeight: book.status === key ? 500 : 400,
                background: book.status === key ? "#EEEDFE" : "transparent",
                color: book.status === key ? "#3C3489" : "#666",
                border: `0.5px solid ${book.status === key ? "#AFA9EC" : "#ddd"}`,
              }}>{label}</div>
            ))}
          </div>
        </div>
      )}

      {book.summary && (
        <div style={{ padding: "0 20px 16px" }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Resumo da IA</div>
          <div style={{ fontSize: 13, color: "#666", lineHeight: 1.5, fontStyle: "italic", padding: "10px 14px", borderRadius: 10, background: "#f5f5f5" }}>
            {book.summary}
          </div>
        </div>
      )}

      <div style={{ padding: "0 20px 16px" }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Generos</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(book.genres || []).map(g => <TagPill key={g} label={g} color={GENRE_COLORS[g] || "purple"} />)}
          {(!book.genres || book.genres.length === 0) && <span style={{ fontSize: 13, color: "#999" }}>Nenhum genero classificado</span>}
        </div>
      </div>

      <div style={{ padding: "0 20px 16px" }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Tropes</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(book.tropes || []).map(t => <TagPill key={t} label={t} color={TROPE_COLORS[t] || "purple"} onClick={onTropeClick ? () => onTropeClick(t) : undefined} />)}
        </div>
      </div>

      {book.description && (
        <div style={{ padding: "0 20px 16px" }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Sinopse</div>
          <div style={{ fontSize: 13, color: "#666", lineHeight: 1.6 }}>{book.description.replace(/<[^>]*>/g, "")}</div>
        </div>
      )}
    </div>
  );
}

// ─── Explore Screen ───────────────────────────────────────────────────────────

function ExploreScreen({ books, onSelectBook, activeTrope, onTropeClick, activeGenre, onSave, initialQuery, initialSearchType }) {
  // ── busca por título/autor (Google Books) ─────────────────────────────────
  const [query, setQuery] = useState(initialQuery || "");
  const [activeSearch, setActiveSearch] = useState(null); // {term, type}
  const [googleResults, setGoogleResults] = useState([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sortOrder, setSortOrder] = useState("relevance");

  // ── painel de detalhe / adicionar livro ───────────────────────────────────
  const [selected, setSelected] = useState(null);
  const [classification, setClassification] = useState(null);
  const [status, setStatus] = useState("quero ler");
  const [saving, setSaving] = useState(false);

  // ── catálogo Supabase + filtros ───────────────────────────────────────────
  const [selectedTropes, setSelectedTropes] = useState(activeTrope ? [activeTrope] : []);
  const [selectedGenre, setSelectedGenre] = useState(activeGenre || "");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [catalogResults, setCatalogResults] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [allGenres, setAllGenres] = useState([]);
  const [allTropes, setAllTropes] = useState([]);

  const myBookIds = new Set(books.map(b => b.googleId).filter(Boolean));

  // sincroniza filtros vindos de props externas (clique em tag)
  useEffect(() => { if (activeTrope) setSelectedTropes([activeTrope]); }, [activeTrope]);
  useEffect(() => { if (activeGenre !== undefined) setSelectedGenre(activeGenre || ""); }, [activeGenre]);

  // gêneros/tropes para o drawer
  useEffect(() => {
    supabaseAuth.from("books").select("genres, tropes").then(({ data }) => {
      if (!data) return;
      setAllGenres([...new Set(data.flatMap(b => b.genres || []))].sort());
      setAllTropes([...new Set(data.flatMap(b => b.tropes || []))].sort());
    });
  }, []);

  // dispara busca ao montar se veio da home com termo inicial
  useEffect(() => {
    if (initialQuery && initialSearchType) doSearch(initialQuery, initialSearchType);
  }, []);

  // ── busca no Google Books ─────────────────────────────────────────────────
  const doSearch = async (term, type) => {
    if (!term?.trim()) return;
    setSelected(null);
    setActiveSearch({ term: term.trim(), type });
    if (type === "title" || type === "author") {
      setGoogleLoading(true);
      const r = await searchGoogleBooks(term.trim(), type);
      setGoogleResults(r);
      setGoogleLoading(false);
    }
    // trope/genre: handled by catalog useEffect below
  };

  // ── catálogo Supabase (default + filtros + busca trope/genre) ─────────────
  const catalogSearchTrope = activeSearch?.type === "trope" ? activeSearch.term : null;
  const catalogSearchGenre = activeSearch?.type === "genre" ? activeSearch.term : null;
  const hasCatalogFilters = selectedTropes.length > 0 || !!selectedGenre || !!catalogSearchTrope || !!catalogSearchGenre;

  useEffect(() => {
    setCatalogLoading(true);
    let q = supabaseAuth
      .from("books")
      .select("id, google_id, title, authors, cover, genres, tropes, save_count, summary")
      .order("save_count", { ascending: false })
      .limit(hasCatalogFilters ? 100 : 20);
    if (selectedGenre) q = q.contains("genres", [selectedGenre]);
    if (catalogSearchGenre) q = q.contains("genres", [catalogSearchGenre]);
    const tropes = [...selectedTropes, ...(catalogSearchTrope ? [catalogSearchTrope] : [])];
    if (tropes.length > 0) q = q.contains("tropes", tropes);
    q.then(({ data }) => { setCatalogResults(data || []); setCatalogLoading(false); });
  }, [selectedGenre, selectedTropes, catalogSearchTrope, catalogSearchGenre]);

  // ── abertura de livro do Google Books ────────────────────────────────────
  const openGoogleBook = async (book) => {
    if (myBookIds.has(book.googleId)) {
      onSelectBook(books.find(b => b.googleId === book.googleId));
      return;
    }
    setSelected(book);
    setClassification(null);
    const cached = await getClassificationForBook(book.googleId);
    if (cached && cached.genres.length > 0) { setClassification(cached); return; }
    const result = await classifyWithAI(book.title, book.authors.join(", "), book.description);
    await saveCanonicalBook(book.googleId, book, result);
    setClassification(result);
  };

  // ── abertura de livro do catálogo ────────────────────────────────────────
  const openCatalogBook = (catalogBook) => {
    const shelfBook = books.find(b => b.googleId === catalogBook.google_id);
    if (shelfBook) { onSelectBook(shelfBook); return; }
    // livro não está na estante — mostra painel de adição
    setSelected({
      googleId: catalogBook.google_id,
      title: catalogBook.title,
      authors: catalogBook.authors || [],
      cover: catalogBook.cover || null,
      description: "",
      pageCount: 0,
    });
    setClassification({
      genres: catalogBook.genres || [],
      tropes: catalogBook.tropes || [],
      summary: catalogBook.summary || "",
    });
  };

  const doSave = async () => {
    if (!selected) return;
    setSaving(true);
    await onSave({ googleId: selected.googleId, status, rating: 0 });
    setSaving(false);
    setSelected(null);
  };

  const toggleTrope = (t) => setSelectedTropes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  const clearAll = () => { setSelectedTropes([]); setSelectedGenre(""); setActiveSearch(null); setQuery(""); setGoogleResults([]); };
  const activeFilterCount = selectedTropes.length + (selectedGenre ? 1 : 0);
  const showGoogleMode = activeSearch && (activeSearch.type === "title" || activeSearch.type === "author");

  // ── render: painel de detalhe ─────────────────────────────────────────────
  if (selected) {
    return (
      <div style={{ paddingBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 20px 16px" }}>
          <svg onClick={() => setSelected(null)} width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ cursor: "pointer" }}>
            <path d="M15 18l-6-6 6-6"/>
          </svg>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>{selected.title}</h1>
        </div>
        <div style={{ padding: "0 20px" }}>
          <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
            <div style={{ width: 90, height: 135, borderRadius: 10, flexShrink: 0, background: selected.cover ? `url(${selected.cover}) center/cover` : getGradient(selected.title) }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3 }}>{selected.title}</div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{selected.authors.join(", ")}</div>
              {selected.pageCount > 0 && <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>{selected.pageCount} páginas</div>}
            </div>
          </div>
          <div style={{ padding: 14, borderRadius: 12, background: "#f5f5f5", marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, color: "#444" }}>
              {classification ? "Classificação por IA" : "Classificando com IA..."}
            </div>
            {!classification ? <TropeSkeleton /> : (
              <>
                {classification.genres?.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {classification.genres.map(g => <TagPill key={g} label={g} color={GENRE_COLORS[g] || "purple"} />)}
                  </div>
                )}
                {classification.tropes?.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {classification.tropes.map(t => <TagPill key={t} label={t} color={TROPE_COLORS[t] || "purple"} />)}
                  </div>
                )}
                {classification.summary && (
                  <div style={{ fontSize: 12, color: "#666", fontStyle: "italic", lineHeight: 1.5 }}>{classification.summary}</div>
                )}
              </>
            )}
          </div>
          {selected.description && (
            <div style={{ fontSize: 13, color: "#666", lineHeight: 1.5, marginBottom: 16,
              display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {selected.description.replace(/<[^>]*>/g, "")}
            </div>
          )}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>Status de leitura</div>
            <div style={{ display: "flex", gap: 8 }}>
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <div key={key} onClick={() => setStatus(key)} style={{
                  flex: 1, padding: "10px 0", borderRadius: 10, textAlign: "center",
                  fontSize: 13, cursor: "pointer", fontWeight: status === key ? 500 : 400,
                  background: status === key ? "#EEEDFE" : "transparent",
                  color: status === key ? "#3C3489" : "#666",
                  border: `0.5px solid ${status === key ? "#AFA9EC" : "#ddd"}`,
                }}>{label}</div>
              ))}
            </div>
          </div>
          <button onClick={doSave} disabled={saving || !classification} style={{
            width: "100%", padding: "14px", borderRadius: 12, border: "none",
            background: saving || !classification ? "#AFA9EC" : "#534AB7",
            color: "white", fontSize: 15, fontWeight: 600, cursor: "pointer",
          }}>
            {saving ? "Salvando..." : !classification ? "Aguardando classificação..." : "Salvar na estante"}
          </button>
        </div>
      </div>
    );
  }

  // ── render: lista ─────────────────────────────────────────────────────────
  const sortedGoogleResults = showGoogleMode
    ? (sortOrder === "recent"
        ? [...googleResults].sort((a, b) => (b.publishedDate || "").localeCompare(a.publishedDate || ""))
        : googleResults)
    : [];

  return (
    <div style={{ paddingBottom: 8 }}>
      <div style={{ padding: "0 20px 12px", display: "flex", alignItems: "center", gap: 10 }}>
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <h1 style={{ fontSize: 22, fontWeight: 600 }}>Explorar</h1>
      </div>

      {/* Campo de busca + botão Filtros */}
      <div style={{ padding: "0 20px 10px", display: "flex", gap: 8, alignItems: "center" }}>
        <SearchInput
          value={query}
          onChange={setQuery}
          onSearch={(term, type) => doSearch(term, type)}
          placeholder="Buscar por título, autor, trope ou gênero..."
        />
        <div onClick={() => setDrawerOpen(true)} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "9px 14px",
          borderRadius: 10, border: "0.5px solid #ddd", cursor: "pointer",
          background: activeFilterCount > 0 ? "#EEEDFE" : "#fff",
          color: activeFilterCount > 0 ? "#3C3489" : "#444",
          fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0,
        }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
          </svg>
          Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </div>
      </div>

      {/* Chips de filtros/busca ativos */}
      {(activeFilterCount > 0 || activeSearch) && (
        <div style={{ padding: "0 20px 10px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {activeSearch && (
            <div onClick={() => { setActiveSearch(null); setQuery(""); setGoogleResults([]); }} style={{
              padding: "4px 10px", borderRadius: 20, fontSize: 12, cursor: "pointer",
              background: "#f5f5f5", color: "#444", border: "0.5px solid #ddd",
            }}>"{activeSearch.term}" ×</div>
          )}
          {selectedGenre && (
            <div onClick={() => setSelectedGenre("")} style={{
              padding: "4px 10px", borderRadius: 20, fontSize: 12, cursor: "pointer",
              background: "#EEEDFE", color: "#3C3489", border: "0.5px solid #AFA9EC",
            }}>{selectedGenre} ×</div>
          )}
          {selectedTropes.map(t => (
            <div key={t} onClick={() => toggleTrope(t)} style={{
              padding: "4px 10px", borderRadius: 20, fontSize: 12, cursor: "pointer",
              background: "#EEEDFE", color: "#3C3489", border: "0.5px solid #AFA9EC",
            }}>{t} ×</div>
          ))}
          <div onClick={clearAll} style={{ fontSize: 12, color: "#999", cursor: "pointer", padding: "4px 6px" }}>Limpar tudo</div>
        </div>
      )}

      {/* Resultados Google Books (busca título/autor) */}
      {showGoogleMode && (
        <div style={{ padding: "0 20px" }}>
          {googleLoading ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#999", fontSize: 14 }}>Buscando...</div>
          ) : googleResults.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#999", fontSize: 14 }}>Nenhum resultado encontrado</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 13, color: "#666" }}>{googleResults.length} resultados</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["relevance", "recent"].map(opt => (
                    <button key={opt} onClick={() => setSortOrder(opt)} style={{
                      fontSize: 12, padding: "3px 10px", borderRadius: 20, cursor: "pointer",
                      border: "0.5px solid #ccc",
                      background: sortOrder === opt ? "#534AB7" : "transparent",
                      color: sortOrder === opt ? "#fff" : "#666",
                      fontWeight: sortOrder === opt ? 500 : 400,
                    }}>{opt === "relevance" ? "Relevância" : "Mais recentes"}</button>
                  ))}
                </div>
              </div>
              {sortedGoogleResults.map(r => {
                const inShelf = myBookIds.has(r.googleId);
                return (
                  <div key={r.googleId} onClick={() => openGoogleBook(r)} style={{
                    display: "flex", gap: 12, padding: 12, marginBottom: 8,
                    borderRadius: 12, border: `0.5px solid ${inShelf ? "#AFA9EC" : "#ddd"}`,
                    cursor: "pointer", background: inShelf ? "#EEEDFE" : "#fff",
                  }}>
                    <div style={{ width: 50, height: 75, borderRadius: 6, flexShrink: 0, background: r.cover ? `url(${r.cover}) center/cover` : getGradient(r.title) }} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                      <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>{r.title}</div>
                      <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{r.authors.join(", ")}</div>
                      {r.publishedDate && <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{r.publishedDate.substring(0, 4)}</div>}
                      {inShelf && <div style={{ fontSize: 11, color: "#534AB7", marginTop: 4, fontWeight: 500 }}>✓ Na sua estante</div>}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Resultados catálogo (default / filtros / busca trope|genre) */}
      {!showGoogleMode && (
        <div style={{ padding: "0 20px" }}>
          {catalogLoading ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#999", fontSize: 14 }}>Buscando...</div>
          ) : catalogResults.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#999" }}>
              <div style={{ fontSize: 15, marginBottom: 4 }}>Nenhum livro encontrado</div>
              <div style={{ fontSize: 13 }}>Tente outros filtros</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
                {hasCatalogFilters
                  ? `${catalogResults.length} ${catalogResults.length === 1 ? "livro encontrado" : "livros encontrados"}`
                  : "Mais populares do catálogo"}
              </div>
              {catalogResults.map(book => {
                const inShelf = myBookIds.has(book.google_id);
                return (
                  <div key={book.id} onClick={() => openCatalogBook(book)} style={{
                    display: "flex", gap: 12, padding: 12, marginBottom: 8,
                    borderRadius: 12, border: `0.5px solid ${inShelf ? "#AFA9EC" : "#ddd"}`,
                    cursor: "pointer", background: inShelf ? "#EEEDFE" : "#fff",
                  }}>
                    <div style={{ width: 50, height: 75, borderRadius: 6, flexShrink: 0, background: book.cover ? `url(${book.cover}) center/cover` : getGradient(book.title) }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{book.title}</div>
                      <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{(book.authors || []).join(", ")}</div>
                      {inShelf && <div style={{ fontSize: 11, color: "#534AB7", marginTop: 4, fontWeight: 500 }}>✓ Na sua estante</div>}
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                        {(book.tropes || []).slice(0, 3).map(t => (
                          <TagPill key={t} label={t} color={TROPE_COLORS[t] || "purple"}
                            onClick={onTropeClick ? (e) => { e.stopPropagation(); onTropeClick(t); } : undefined} />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* Drawer de filtros */}
      {drawerOpen && (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.25)" }} />
          <div style={{
            position: "fixed", top: 0, right: 0, bottom: 0, width: "82%", maxWidth: 320,
            background: "#fff", zIndex: 50, boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
            overflowY: "auto", padding: "20px 20px 40px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={{ fontSize: 17, fontWeight: 600 }}>Filtros</div>
              <div onClick={() => setDrawerOpen(false)} style={{ fontSize: 22, color: "#888", cursor: "pointer", lineHeight: 1 }}>×</div>
            </div>
            {allGenres.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#666", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Gêneros</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {allGenres.map(g => (
                    <div key={g} onClick={() => setSelectedGenre(selectedGenre === g ? "" : g)} style={{
                      padding: "6px 14px", borderRadius: 20, fontSize: 13, cursor: "pointer",
                      background: selectedGenre === g ? "#EEEDFE" : "transparent",
                      color: selectedGenre === g ? "#3C3489" : "#555",
                      border: `0.5px solid ${selectedGenre === g ? "#AFA9EC" : "#ddd"}`,
                      fontWeight: selectedGenre === g ? 500 : 400,
                    }}>{g}</div>
                  ))}
                </div>
              </div>
            )}
            {allTropes.length > 0 && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#666", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Tropes</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {allTropes.map(t => (
                    <div key={t} onClick={() => toggleTrope(t)} style={{
                      padding: "6px 12px", borderRadius: 16, fontSize: 12, cursor: "pointer",
                      background: selectedTropes.includes(t) ? "#EEEDFE" : "#f5f5f5",
                      color: selectedTropes.includes(t) ? "#3C3489" : "#555",
                      border: selectedTropes.includes(t) ? "0.5px solid #AFA9EC" : "0.5px solid transparent",
                      fontWeight: selectedTropes.includes(t) ? 500 : 400,
                    }}>{t}</div>
                  ))}
                </div>
              </div>
            )}
            {activeFilterCount > 0 && (
              <div onClick={() => { setSelectedTropes([]); setSelectedGenre(""); }} style={{
                marginTop: 24, padding: "10px 0", textAlign: "center", fontSize: 13,
                color: "#999", cursor: "pointer", borderTop: "0.5px solid #eee",
              }}>Limpar filtros</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Reco Screen ──────────────────────────────────────────────────────────────

function RecoScreen({ books, onSelectBook }) {
  if (books.length < 2) {
    return (
      <div style={{ paddingBottom: 8 }}>
        <div style={{ padding: "0 20px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
          </svg>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>Pra mim</h1>
        </div>
        <div style={{ textAlign: "center", padding: "40px 20px", color: "#999" }}>
          <div style={{ fontSize: 15, marginBottom: 4 }}>Adicione mais livros!</div>
          <div style={{ fontSize: 13 }}>Preciso de pelo menos 2 livros pra gerar recomendacoes</div>
        </div>
      </div>
    );
  }

  const tropeCounts = {};
  books.forEach(b => (b.tropes || []).forEach(t => { tropeCounts[t] = (tropeCounts[t] || 0) + 1; }));
  const topTropes = Object.entries(tropeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const recommendations = buildRecommendations(books);

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
              <div key={trope} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 16, background: "#EEEDFE" }}>
                <span style={{ fontSize: 12, color: "#3C3489" }}>{trope}</span>
                <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "#AFA9EC", color: "#26215C" }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recommendations.length > 0 ? (
        <div style={{ padding: "0 20px" }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Livros semelhantes na sua estante</div>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>Baseado nas tropes em comum</div>
          {recommendations.slice(0, 6).map(({ book, similarity, basedOn }) => (
            <div key={book.id} onClick={() => onSelectBook(book)} style={{
              display: "flex", gap: 12, padding: 14, marginBottom: 10,
              borderRadius: 12, border: "0.5px solid #ddd", cursor: "pointer", background: "#fff",
            }}>
              <div style={{ width: 56, height: 84, borderRadius: 8, flexShrink: 0, background: book.cover ? `url(${book.cover}) center/cover` : getGradient(book.title) }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{book.title}</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{book.authors?.join(", ")}</div>
                <div style={{ fontSize: 11, color: "#999", marginTop: 4, fontStyle: "italic" }}>Parecido com "{basedOn.title}"</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                  {(book.tropes || []).slice(0, 3).map(t => <TagPill key={t} label={t} color={TROPE_COLORS[t] || "purple"} />)}
                </div>
                <div style={{ height: 4, borderRadius: 2, background: "#f0f0f0", marginTop: 8 }}>
                  <div style={{ height: "100%", borderRadius: 2, background: "#534AB7", width: `${similarity}%` }} />
                </div>
                <div style={{ fontSize: 11, color: "#534AB7", fontWeight: 500, marginTop: 3 }}>{similarity}% compativel</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "20px", color: "#999" }}>
          <div style={{ fontSize: 13 }}>Adicione mais livros com tropes parecidas pra ver recomendacoes</div>
        </div>
      )}
    </div>
  );
}

// ─── Config Screen ────────────────────────────────────────────────────────────

function ConfigScreen({ books, onImportBook, session, supabaseClient }) {
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const fileInputRef = useRef(null);

  const normTitleSimple = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const handleCsvImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());

    let rows = lines.map(l => {
      const parts = l.split(",");
      return { title: (parts[0] || "").replace(/^"|"$/g, "").trim(), author: (parts[1] || "").replace(/^"|"$/g, "").trim() };
    }).filter(r => r.title);

    // Tolera header
    if (rows.length > 0 && /^(t[ií]tulo?|title|nome|book)/i.test(rows[0].title)) {
      rows = rows.slice(1);
    }

    if (rows.length === 0) return;

    const existingTitles = new Set(books.map(b => normTitleSimple(b.title)));
    setImporting(true);
    setImportProgress(null);
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const { title, author } = rows[i];
      setImportProgress({ current: i + 1, total: rows.length, title });

      if (existingTitles.has(normTitleSimple(title))) {
        skipped++;
        continue;
      }

      try {
        const key = process.env.NEXT_PUBLIC_GOOGLE_BOOKS_API_KEY;
        const q = author ? `${title} ${author}` : title;
        const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&key=${key}&maxResults=1`);
        const data = await res.json();
        const item = data.items?.[0];

        if (!item) {
          skipped++;
        } else {
          const v = item.volumeInfo;
          const book = {
            id: crypto.randomUUID(),
            googleId: item.id,
            title: v.title || title,
            authors: v.authors || (author ? [author] : []),
            description: v.description || "",
            cover: v.imageLinks?.thumbnail?.replace("http:", "https:") || null,
            publishedDate: v.publishedDate || "",
            pageCount: v.pageCount || 0,
            status: "lido",
            genres: [],
            tropes: [],
            summary: "",
            rating: 0,
            addedAt: new Date().toISOString(),
          };

          const cl = await classifyWithAI(book.title, book.authors.join(", "), book.description);
          book.genres = cl.genres || [];
          book.tropes = cl.tropes || [];
          book.summary = cl.summary || "";

          if (book.googleId) {
            if (!cl.canonical_key) {
              cl.canonical_key = `google-id_${book.googleId.slice(0, 8)}`;
            }
            await saveCanonicalBook(book.googleId, book, cl);
          }

          await onImportBook(book);
          existingTitles.add(normTitleSimple(book.title));
          imported++;
        }
      } catch (err) {
        console.error("import error:", err);
        skipped++;
      }

      if (i < rows.length - 1) await new Promise(r => setTimeout(r, 500));
    }

    setImportProgress({ done: true, imported, skipped });
    setImporting(false);
    e.target.value = "";
  };

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

        <div style={{ padding: 16, borderRadius: 12, background: "#f5f5f5", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Conta</div>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>{session?.user?.email}</div>
          <button onClick={() => supabaseClient.auth.signOut()} style={{
            padding: "8px 20px", borderRadius: 8, border: "0.5px solid #ddd",
            background: "#fff", fontSize: 13, cursor: "pointer", color: "#444",
          }}>
            Sair da conta
          </button>
        </div>

        <div style={{ padding: 16, borderRadius: 12, background: "#f5f5f5", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Sobre o app</div>
          <div style={{ fontSize: 13, color: "#666", lineHeight: 1.6 }}>
            Minha Estante e sua biblioteca pessoal inteligente. Adicione livros, classifique por tropes com ajuda de IA, e descubra livros parecidos na sua colecao.
          </div>
        </div>

        <div style={{ padding: 16, borderRadius: 12, background: "#f5f5f5", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Importar biblioteca</div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 12, lineHeight: 1.5 }}>
            Importe um CSV com seus livros. Formato esperado: <strong>titulo,autor</strong> (uma linha por livro).
          </div>

          {importProgress && !importProgress.done && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "#444", marginBottom: 6 }}>
                Importando livro {importProgress.current} de {importProgress.total}: <em>{importProgress.title}</em>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "#e0e0e0" }}>
                <div style={{
                  height: "100%", borderRadius: 3, background: "#534AB7",
                  width: `${Math.round((importProgress.current / importProgress.total) * 100)}%`,
                  transition: "width 0.3s ease",
                }} />
              </div>
            </div>
          )}

          {importProgress?.done && (
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "#E1F5EE", marginBottom: 12, fontSize: 13, color: "#085041" }}>
              {importProgress.imported} {importProgress.imported === 1 ? "livro importado" : "livros importados"}
              {importProgress.skipped > 0 && `, ${importProgress.skipped} ignorados por ja existirem`}.
            </div>
          )}

          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleCsvImport} />
          <button
            disabled={importing}
            onClick={() => { setImportProgress(null); fileInputRef.current?.click(); }}
            style={{
              padding: "9px 20px", borderRadius: 8, border: "0.5px solid #AFA9EC",
              background: importing ? "#f0f0f0" : "#EEEDFE", color: importing ? "#999" : "#3C3489",
              fontSize: 13, fontWeight: 500, cursor: importing ? "default" : "pointer",
            }}>
            {importing ? "Importando..." : "Escolher arquivo CSV"}
          </button>
        </div>

        <div style={{ padding: 16, borderRadius: 12, border: "0.5px solid #f5c1c1", background: "#fcebeb" }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4, color: "#a32d2d" }}>Limpar dados</div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>Remove todos os livros da sua estante. Esta acao nao pode ser desfeita.</div>
          <button onClick={async () => {
            if (confirm("Tem certeza? Todos os livros serao removidos.")) {
              await supabaseAuth.from("books").delete().neq("id", "");
              window.location.reload();
            }
          }} style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#a32d2d", color: "white", fontSize: 13, cursor: "pointer" }}>
            Limpar tudo
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────

function LoginScreen() {
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    await supabaseAuth.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "40px 32px", background: "#fff", maxWidth: 430, margin: "0 auto",
    }}>
      <div style={{ fontSize: 56, marginBottom: 24 }}>📚</div>
      <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8, fontFamily: "'Abril Fatface', cursive", textAlign: "center" }}>
        Minha Estante
      </h1>
      <p style={{ fontSize: 14, color: "#666", textAlign: "center", lineHeight: 1.6, marginBottom: 40 }}>
        Sua biblioteca pessoal inteligente com classificação por tropes
      </p>
      <button
        onClick={handleLogin}
        disabled={loading}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px 24px", borderRadius: 12, border: "0.5px solid #ddd",
          background: loading ? "#f5f5f5" : "#fff", cursor: loading ? "default" : "pointer",
          fontSize: 15, fontWeight: 500, color: "#222", width: "100%",
          justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        }}
      >
        <svg width={20} height={20} viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        {loading ? "Redirecionando..." : "Entrar com Google"}
      </button>
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState(undefined);
  const [books, setBooks] = useState([]);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [screen, setScreen] = useState("home");
  const [selectedBook, setSelectedBook] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [activeTrope, setActiveTrope] = useState(null);
  const [activeGenre, setActiveGenre] = useState(null);
  const [exploreQuery, setExploreQuery] = useState("");
  const [exploreSearchType, setExploreSearchType] = useState("title");
  const scrollRef = useRef(null);

  useEffect(() => {
    supabaseAuth.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabaseAuth.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    fetchBooks(session.user.id).then(data => { setBooks(data); setLoadingBooks(false); });
  }, [session]);

  useEffect(() => { scrollRef.current?.scrollTo(0, 0); }, [screen, selectedBook]);

  const navigate = (s) => { setScreen(s); setSelectedBook(null); };

  const addBook = async ({ googleId, status, rating }) => {
    await insertBook({ googleId, status, rating }, session.user.id);
    const fresh = await fetchBooks(session.user.id);
    setBooks(fresh);
    setScreen("home");
  };

  const updateBook = (updated) => {
    setBooks(prev => prev.map(b => b.id === updated.id ? updated : b));
    setSelectedBook(updated);
  };

  const deleteBook = async (id) => {
    await deleteBookFromDb(id, session.user.id);
    setBooks(prev => prev.filter(b => b.id !== id));
  };

  const importBook = async (book) => {
    await insertBook({ googleId: book.googleId, status: book.status, rating: book.rating }, session.user.id);
    const fresh = await fetchBooks(session.user.id);
    setBooks(fresh);
  };

  const handleTropeClick = (trope) => { setActiveTrope(trope); setExploreQuery(""); setScreen("explore"); setSelectedBook(null); };
  const handleGenreClick = (genre) => { setActiveGenre(genre); setExploreQuery(""); setScreen("explore"); setSelectedBook(null); };
  const handleHomeSearch = (term, type) => { setExploreQuery(term); setExploreSearchType(type); setActiveTrope(null); setActiveGenre(null); setScreen("explore"); setSelectedBook(null); };

  const activeTab = ["detail"].includes(screen) ? "home" : screen;

  if (session === undefined) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48 }}>
        📚
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  return (
    <div style={{
      maxWidth: 430, margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      minHeight: "100vh", display: "flex", flexDirection: "column", background: "#fff", color: "#222",
    }}>
      <div ref={scrollRef} style={{ flex: 1, paddingTop: 16, paddingBottom: 64, overflowY: "auto" }}>
        {screen === "home" && (
          <HomeScreen books={books} loading={loadingBooks}
            onSelectBook={(b) => { setSelectedBook(b); setScreen("detail"); }}
            onSearch={handleHomeSearch}
            statusFilter={statusFilter} setStatusFilter={setStatusFilter}
            onGenreClick={handleGenreClick} onTropeClick={handleTropeClick}
          />
        )}
        {screen === "detail" && selectedBook && (
          <BookDetailScreen book={selectedBook} onBack={() => setScreen("home")} onUpdate={updateBook} onDelete={deleteBook} userId={session.user.id} onTropeClick={handleTropeClick} />
        )}
        {screen === "explore" && (
          <ExploreScreen books={books}
            onSelectBook={(b) => { setSelectedBook(b); setScreen("detail"); }}
            onSave={addBook}
            activeTrope={activeTrope} onTropeClick={handleTropeClick}
            activeGenre={activeGenre}
            initialQuery={exploreQuery} initialSearchType={exploreSearchType}
          />
        )}
        {screen === "reco" && <RecoScreen books={books} onSelectBook={(b) => { setSelectedBook(b); setScreen("detail"); }} />}
        {screen === "config" && <ConfigScreen books={books} onImportBook={importBook} session={session} supabaseClient={supabaseAuth} />}
      </div>
      <BottomNav active={activeTab} onNavigate={navigate} />
    </div>
  );
}