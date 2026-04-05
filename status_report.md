# Minha Estante – Status Report & Arquitetura

## Infra & Acesso

| Item | Valor |
|------|-------|
| Repositório | github.com/marianatoniol/minha-estante |
| Deploy | Vercel – https://minha-estante-dun.vercel.app |
| Supabase URL | https://ryupcmkbdfhnjxnpbviw.supabase.co |
| Supabase Anon Key | Variáveis de ambiente do Vercel e .env.local |
| Editor | VS Code com Claude Code |

> **Lembrete:** sempre incluir "faz commit e push" nos prompts pro Claude Code – sem isso, o Vercel não redeploya.

---

## Stack

- **Frontend:** Next.js 14, PWA, arquivo principal `app/page.js`
- **Banco:** Supabase (PostgreSQL)
- **IA – Classificação:** Claude Sonnet via `app/api/classify/route.js` (com web search habilitado; parsing defensivo via `safeParseAIJson`)
- **IA – Qualidade:** Claude Haiku via `app/api/quality/route.js`
- **Busca:** Google Books API (título/autor) + Supabase `books` (trope/gênero)
- **Auth:** Supabase Auth com Google OAuth

---

## Arquitetura de Dados

### Modelo de 3 tabelas

```
books_catalog          books                    bookcase
─────────────          ─────                    ────────
google_id (UNIQUE) ───► book_id (FK) ─── book_id (FK) ──── user_id
metadados brutos        canonical_key (UNIQUE)           status
quality_score           genres, tropes                   rating
is_spam                 summary, description             added_at
view_count (legado)     page_count
save_count (legado)     authors (text[])
                        google_ids (text[])
                        view_count, save_count
                        rating_avg, rating_count
```

**Princípio:** cada tabela tem uma responsabilidade única. Nenhuma duplica dado da outra.

---

### books_catalog – entrada bruta do Google Books

Criada na primeira vez que qualquer usuário busca o livro. Compartilhada entre todos os usuários.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| google_id | text UNIQUE | ID do volume no Google Books |
| title, authors, description, cover | text | Metadados brutos |
| published_date, page_count | text / int | Metadados brutos |
| quality_score | int | Score da análise de qualidade (Haiku) |
| is_spam | bool | Livro identificado como spam/acadêmico |
| quality_checked | bool | Se já passou pela análise de qualidade |
| view_count, save_count | int | Legado – não atualizados mais |
| book_id | uuid FK → books.id | Ponteiro pro catálogo canônico |

---

### books – catálogo canônico

Criado na primeira vez que qualquer usuário abre a página do livro. Compartilhado entre todos os usuários.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| canonical_key | text UNIQUE | Identificador canônico: sobrenome-autor_titulo-curto em inglês |
| google_id | text | Google ID da versão principal |
| google_ids | text[] | Todos os google_ids associados (incluindo traduções) |
| title, authors | text / text[] | Título e autores curados |
| cover, description, page_count | – | Metadados curados |
| genres, tropes | text[] | Classificação por IA |
| summary | text | Resumo em português gerado pela IA |
| view_count, save_count | int | Sinais de engajamento |
| rating_avg, rating_count | float / int | Rating agregado de todos os usuários |

**Deduplicação por tradução:** a IA usa web search para identificar o título original do livro e sempre gera a `canonical_key` baseada nele. Traduções do mesmo livro colapsam no mesmo registro em `books`, com seus `google_id` acumulados em `google_ids`.

**Fallback de `canonical_key`:** se a IA retornar `canonical_key` vazia (falha silenciosa), o código gera automaticamente `google-id_<primeiros 8 chars do googleId>` antes de chamar `saveCanonicalBook`, evitando erro 23505 por conflito de unique constraint com string vazia.

---

### bookcase – estante pessoal

Criada quando o usuário salva um livro. Privada por usuário (RLS ativo).

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| user_id | uuid FK → auth.users | Usuário dono |
| book_id | uuid FK → books.id | Livro canônico |
| status | text | quero ler / lido |
| rating | int | Avaliação individual do usuário (0–5) |
| added_at | timestamp | Data de adição |

**Constraints:** `UNIQUE (user_id, book_id)` – impede duplicatas mesmo que o usuário salve edições ou traduções diferentes do mesmo livro.

---

## Fluxos Principais

### Busca de livros (tela Explorar)

- **Busca por título ou autor:** duas queries paralelas ao Google Books (`langRestrict=pt` + sem restrição), `intitle:query` ou `inauthor:query`, 20 resultados cada. Deduplicação por `google_id`. Filtro: livros com menos de 50 páginas removidos. Ordenação por relevância ou data de publicação.
- **Busca por trope:** query Supabase `books.contains("tropes", [trope])`.
- **Busca por gênero:** query Supabase `books.contains("genres", [genre])`.
- **Default (sem busca nem filtros):** os 20 livros mais populares da tabela `books` ordenados por `save_count` decrescente.

### Abrir livro (classificação)

- Busca `book_id` em `books_catalog` pelo `google_id`
- Se tiver `book_id` → busca em `books` → usa cache (genres, tropes, summary). Incrementa `view_count` em `books`
- Se não tiver → chama Sonnet com web search → gera `canonical_key` baseada no título original
- INSERT em `books`. Se falhar com erro `23505` (canonical_key duplicada = tradução já catalogada) → reusa o id existente e adiciona `google_id` ao array `google_ids`
- UPDATE `books_catalog.book_id` com o id obtido
- `saveCanonicalBook` retorna o `bookId` gerado/encontrado

### Abrir livro já na estante (BookDetailScreen)

Se o `googleId` do resultado selecionado já existir na estante do usuário (`myBooks`), o app navega diretamente para `BookDetailScreen` — sem passar pelo fluxo de classificação/adicionar.

Ao abrir, o useEffect verifica duas condições independentes:

1. **`book.genres` vazio:** busca classificação em cache (`getClassificationForBook`); se não encontrar, chama `classifyWithAI` → `saveCanonicalBook` → atualiza UI
2. **`book.genres` preenchido mas `books_catalog.book_id` nulo:** busca `canonical_key` diretamente em `books` pelo `google_id` e re-executa `saveCanonicalBook` para reparar o vínculo quebrado; atualiza UI

### Abrir livro do catálogo (ExploreScreen)

Ao clicar num livro do catálogo Supabase que não está na estante:

- Se `genres` preenchido: exibe painel imediatamente com dados do catálogo
- Se `genres` vazio (classificação falhou silenciosamente no passado): exibe skeleton, chama `classifyWithAI` + `saveCanonicalBook`, preenche o painel com o resultado

### Salvar na estante

- `insertBook` aceita `bookId` diretamente quando já disponível (fluxo CSV); nesse caso, pula a busca em `books_catalog`
- Se `bookId` não for fornecido (fluxo ExploreScreen/addBook), busca `book_id` em `books_catalog` pelo `google_id`
- INSERT em `bookcase` com `{ user_id, book_id, status, rating, added_at }`
- Erro `23505` tratado silenciosamente (livro já na estante)
- Incrementa `books.save_count` em background

### Importação via CSV (ConfigScreen)

- Lê arquivo `.csv` com formato `titulo,autor` (uma linha por livro); tolera header
- Por livro: busca no Google Books → `classifyWithAI` → valida `canonical_key` (gera fallback `google-id_<8chars>` se vazia) → `saveCanonicalBook` → captura `bookId` retornado → `insertBook` com `bookId` direto (sem lookup em `books_catalog`)
- Intervalo de 500 ms entre livros para evitar rate limiting
- Livros já na estante (por título normalizado) são pulados
- **Botão "Parar importação"** visível durante o processo: ao clicar, seta flag; o loop para após terminar o livro atual. Resultado final distingue "cancelada" (âmbar) de "concluída" (verde)

### Fetch da estante

Join `bookcase → books` – todos os metadados vêm de `books`. Arrays nativos do Postgres, sem `JSON.parse`.

### Atualizar status ou rating

Clique direto na UI salva imediatamente via `updateBookInDb` (sem botão de confirmar). Ao atualizar rating, `updateRatingAvgInDb` recalcula a média buscando todos os ratings > 0 da `bookcase` para aquele `book_id` e faz update em `books.rating_avg` e `books.rating_count` – em fire-and-forget.

---

## Proteções no Banco

| Proteção | Onde | Por quê |
|----------|------|---------|
| UNIQUE (canonical_key) | books | Impede duplicatas de livros canônicos |
| UNIQUE (google_id) | books_catalog | Uma entrada por volume do Google Books |
| UNIQUE (user_id, book_id) | bookcase | Impede salvar o mesmo livro duas vezes (mesmo via tradução) |
| RLS ativo | bookcase | Cada usuário só vê e edita sua própria estante |
| Tratamento de erro 23505 | código | Colisões de canonical_key e bookcase tratadas graciosamente |
| Parsing defensivo (`safeParseAIJson`) | `app/api/classify/route.js` | Se o modelo responder em prosa, extrai o primeiro bloco `{…}` válido; se falhar, retorna defaults em vez de lançar erro |

---

## Testes Automatizados

Configurados com Vitest. Rodar com `npm test`.

### Cobertura atual – 49 testes, todos passando

| Função | Arquivo | Testes |
|--------|---------|--------|
| getGradient | lib/utils.js | 3 |
| getSimilarity | lib/utils.js | 5 |
| filterBooks | lib/utils.js | 10 |
| filterByExplore | lib/utils.js | 7 |
| buildRecommendations | lib/utils.js | 8 |
| normalizeBookRow | lib/utils.js | 3 |
| parseAIJson | lib/utils.js | 4 |
| safeParseAIJson | lib/utils.js | 9 |
| **Total** | | **49** |

> `filterByExplore` ainda está em `lib/utils.js` e coberta por testes, mesmo que a lógica equivalente no ExploreScreen seja feita via query Supabase. A função permanece útil para testes unitários isolados.

### O que não está coberto por testes automatizados

- Fluxos que dependem do Supabase (`fetchBooks`, `insertBook`, `updateBookInDb`, `updateRatingAvgInDb`, `saveCanonicalBook`) – testar manualmente
- Fluxos que dependem da API do Claude (`classifyWithAI`, rota `/api/classify`) – testar manualmente
- Componentes React (`HomeScreen`, `BookDetailScreen`, `ExploreScreen`, `ConfigScreen`, etc.) – não vale o esforço agora
- Lógica de exibição de estrelas proporcionais ao `rating_avg` – inline no componente, extrair e testar só quando a lógica crescer

---

## Hábitos recomendados

- Sempre adicionar "roda `npm test` antes de commitar" nos prompts pro Claude Code quando a mudança tocar em `lib/utils.js` ou `app/page.js`
- Toda nova feature que tiver lógica pura (filtros, cálculos, transformações de dados) deve ser extraída para `lib/utils.js` e coberta por testes antes de ir pro ar
- Validações de dados obrigatórios (`title`, `googleId`) devem existir antes de qualquer chamada às rotas `/api/quality` e `/api/classify` – tanto no `page.js` quanto dentro das próprias rotas

---

## O que ainda precisa ser testado (manualmente)

- `BookDetailScreen` para livros com `books_catalog.book_id` nulo — verificar se o repair automático funciona em produção
- Livro do catálogo com `genres` vazio no ExploreScreen — verificar se classificação + skeleton aparecem corretamente
- Importação via CSV: fluxo completo, botão cancelar, mensagem de resultado (concluída vs cancelada)
- `save_count` e `view_count` sendo incrementados corretamente em `books`
- Rating global (`rating_avg`, `rating_count`) sendo atualizado corretamente ao mudar estrelas
- Fluxo completo do Explorar: busca por título/autor (Google Books) → painel de adição → salvar
- Fluxo: clicar em tag de trope/gênero → navegação para Explorar com filtro ativo

---

## UI – Comportamentos atuais

### TagPill – tags clicáveis

`TagPill` aceita prop `onClick`. Quando presente, a tag exibe `cursor: pointer`. Tags de **trope** são clicáveis em:
- `BookDetailScreen` (página do livro)
- Cards da tela Explorar

Tags de **gênero** são clicáveis em:
- Cards da `HomeScreen`

Clicar numa tag navega para a tela Explorar com aquele trope ou gênero já ativo como filtro. O estado do filtro ativo (`activeTrope`, `activeGenre`) fica no componente raiz `App` e persiste ao trocar de aba e voltar.

Altura mínima de 30px em todas as tags (padding `8px 10px`) para facilitar o toque em mobile.

### Campo de busca (SearchInput)

Exibido na `HomeScreen` e na tela Explorar. Dropdown com 4 opções ao digitar:
- 📖 como título
- ✍️ como autor
- ✨ como trope
- 🏷️ como gênero

Pressionar Enter busca como título por padrão. O dropdown fecha ao selecionar uma opção ou pressionar Enter.

**Na HomeScreen:** buscar navega para o Explorar com o termo preenchido e a busca já disparada. A HomeScreen não tem mais tela própria de busca — o `AddBookScreen` foi removido.

**No Explorar:** busca dispara no próprio campo e exibe resultados na mesma tela.

### Tela Explorar (reformulada)

A tela Explorar é agora a central de descoberta e adição de livros do app. Comportamentos:

- **Default (sem busca/filtros):** lista os 20 livros mais populares do catálogo global (`books`, ordenados por `save_count` desc) com label "Mais populares do catálogo"
- **Busca por título/autor:** consulta Google Books, exibe resultados com ordenação relevância/data. Livros já na estante são marcados com borda roxa e badge "✓ Na sua estante"
- **Busca por trope/gênero:** consulta tabela `books` no Supabase via `.contains()`
- **Drawer de filtros:** botão "Filtros" abre painel lateral com todos os gêneros e tropes disponíveis no catálogo global. Seleção múltipla. Fecha ao clicar fora. Filtros ativos mostrados como chips removíveis acima dos resultados
- **Filtros e busca combinam:** drawer de filtros funciona em paralelo com a busca por trope/gênero
- **Painel de adição:** clicar num livro do Google Books abre painel inline com classificação por IA, seleção de status e botão "Salvar na estante". Clicar num livro do catálogo que já está na estante abre o `BookDetailScreen`

**`AddBookScreen` foi removido.** Toda a lógica de classificação, `saveCanonicalBook` e adição à estante agora vive dentro do `ExploreScreen`.

### Página do livro (BookDetailScreen)

- Mesma página para livros abertos pela busca ou pela estante
- Sem modo de edição – status e rating são clicáveis diretamente
- Status disponíveis: quero ler e lido
- Seção de status só aparece se o livro estiver na estante (`book.id` presente)
- Rating individual (estrelas do usuário) sempre clicável, salva imediatamente
- Rating global exibido abaixo das estrelas do usuário no formato `4.2 ★★★★☆ · 12 avaliações` – só aparece se `rating_count > 0`
- Tags de trope clicáveis: navega para Explorar com filtro ativo

---

## Roadmap

### Curto prazo

- [x] Busca por autor
- [x] Busca por trope (catálogo global)
- [x] Busca por gênero
- [x] Tags de trope e gênero clicáveis — navegação para Explorar com filtro ativo
- [x] Tela Explorar reformulada — catálogo global, busca unificada, drawer de filtros, painel de adição
- [x] AddBookScreen removido — Explorar absorveu todas as funcionalidades
- [x] Home search vira atalho para o Explorar
- [x] Explorar mostra 20 mais populares por default
- [x] CSV import para bulk-add de livros como "lido" – fluxo corrigido, `bookId` passado direto, botão cancelar, fallback de `canonical_key`
- [ ] Remover status `lendo` da home (filtros) e de qualquer outro lugar remanescente
- [ ] Testar e validar contadores de engajamento (`view_count`, `save_count`)

### Médio prazo

- [ ] Seleção de idioma preferido nas configurações do usuário
- [ ] Na página do livro: mostrar edições disponíveis em outros idiomas (base já preparada com `google_ids`)
- [ ] Recomendações por similaridade de tropes (tela "Pra mim" já tem a lógica básica)

### Longo prazo

- [ ] Score de relevância na busca usando `view_count` e `save_count` de `books` (hoje ainda usa legado de `books_catalog`)

---

## Como Trabalhar

- Você descreve o problema ou a feature – pensamos juntos antes de partir pro código
- Sem código nas respostas – prompts formulados aqui, executados no Claude Code
- Um prompt por vez – testa e confirma antes do próximo
- Sempre incluir "faz commit e push" no final dos prompts pro Claude Code
- Quando precisar entender o estado atual do código, pede pro Claude Code explicar um fluxo específico e cola a resposta aqui
