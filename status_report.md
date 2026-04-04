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
- **IA – Classificação:** Claude Sonnet via `app/api/classify/route.js` (com web search habilitado)
- **IA – Qualidade:** Claude Haiku via `app/api/quality/route.js`
- **Busca:** Google Books API
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

### Busca de livros

- Duas queries paralelas ao Google Books (`langRestrict=pt` + sem restrição), `intitle:query` ou `inauthor:query` dependendo do tipo de busca, 20 resultados cada
- Deduplicação por `google_id` e por `book_id` (edições do mesmo livro colapsadas)
- Filtro: livros com menos de 50 páginas são removidos
- Score de relevância composto: match com query + quality score + engajamento (`view_count`, `save_count`)
- Em background: livros sem `quality_checked` disparam análise via Haiku e salvam resultado em `books_catalog`

### Abrir livro (classificação)

- Busca `book_id` em `books_catalog` pelo `google_id`
- Se tiver `book_id` → busca em `books` → usa cache (genres, tropes, summary). Incrementa `view_count` em `books`
- Se não tiver → chama Sonnet com web search → gera `canonical_key` baseada no título original
- INSERT em `books`. Se falhar com erro `23505` (canonical_key duplicada = tradução já catalogada) → reusa o id existente e adiciona `google_id` ao array `google_ids`
- UPDATE `books_catalog.book_id` com o id obtido

### Abrir livro pela busca (livro já na estante)

Se o `googleId` do livro selecionado na busca já existir em `myBooks`, `AddBookScreen` chama `onOpenExisting(livroExistente)` e navega direto pra `BookDetailScreen` – sem passar pelo fluxo de adicionar.

### Salvar na estante

- Busca `book_id` em `books_catalog` pelo `google_id`
- INSERT em `bookcase` com `{ user_id, book_id, status, rating, added_at }`
- Erro `23505` tratado silenciosamente (livro já na estante)
- Incrementa `books.save_count` em background

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

---

## Testes Automatizados

Configurados com Vitest. Rodar com `npm test`.

### Cobertura atual – 33 testes, todos passando

| Função | Arquivo | Testes |
|--------|---------|--------|
| getGradient | lib/utils.js | 3 |
| getSimilarity | lib/utils.js | 5 |
| filterBooks | lib/utils.js | 7 |
| filterByExplore | lib/utils.js | 6 |
| buildRecommendations | lib/utils.js | 6 |
| normalizeBookRow | lib/utils.js | 2 |
| parseAIJson | lib/utils.js | 4 |
| **Total** | | **33** |

### O que não está coberto por testes automatizados

- Fluxos que dependem do Supabase (`fetchBooks`, `insertBook`, `updateBookInDb`, `updateRatingAvgInDb`) – testar manualmente
- Fluxos que dependem da API do Claude – testar manualmente
- Componentes React (`HomeScreen`, `BookDetailScreen`, etc.) – não vale o esforço agora
- Lógica de exibição de estrelas proporcionais ao `rating_avg` – inline no componente, extrair e testar só quando a lógica crescer

---

## Hábitos recomendados

- Sempre adicionar "roda `npm test` antes de commitar" nos prompts pro Claude Code quando a mudança tocar em `lib/utils.js` ou `app/page.js`
- Toda nova feature que tiver lógica pura (filtros, cálculos, transformações de dados) deve ser extraída para `lib/utils.js` e coberta por testes antes de ir pro ar
- Validações de dados obrigatórios (`title`, `googleId`) devem existir antes de qualquer chamada às rotas `/api/quality` e `/api/classify` – tanto no `page.js` quanto dentro das próprias rotas

---

## O que ainda precisa ser testado (manualmente)

- `BookDetailScreen` para livros já salvos sem genres
- `save_count` e `view_count` sendo incrementados corretamente em `books`
- `importBook` com o novo schema
- Rating global (`rating_avg`, `rating_count`) sendo atualizado corretamente ao mudar estrelas

---

## UI – Comportamentos atuais

### Campo de busca (SearchInput)

O campo de busca nas telas `HomeScreen` e `AddBookScreen` exibe um dropdown com 3 opções ao digitar:
- 📖 como título
- ✍️ como autor
- ✨ como trope

Ao selecionar uma opção, a busca é disparada com o contexto certo e o dropdown fecha. Pressionar Enter busca como título por padrão. O filtro local da estante na `HomeScreen` continua funcionando enquanto digita, sem precisar selecionar uma opção.

Busca por autor usa `inauthor:` na query do Google Books. Busca por trope consulta a tabela `books` do Supabase via `.contains("tropes", [trope])` – retorna apenas livros já catalogados, com mensagem explicativa quando não há resultados. Busca por título mantém o comportamento anterior com `intitle:`.

### Página do livro (BookDetailScreen)

- Mesma página para livros abertos pela busca ou pela estante
- Sem modo de edição – status e rating são clicáveis diretamente
- Status disponíveis: quero ler e lido (removido lendo)
- Seção de status só aparece se o livro estiver na estante (`book.id` presente)
- Rating individual (estrelas do usuário) sempre clicável, salva imediatamente
- Rating global exibido abaixo das estrelas do usuário no formato `4.2 ★★★★☆ · 12 avaliações` – só aparece se `rating_count > 0`
- Edição de tropes removida por ora

---

## Roadmap

### Curto prazo

- [x] Busca por autor
- [ ] CSV import para bulk-add de livros como "lido" – verificar e corrigir `importBook` com novo schema
- [ ] Remover status `lendo` da home (filtros) e de qualquer outro lugar remanescente
- [ ] Testar e validar contadores de engajamento (`view_count`, `save_count`)

### Médio prazo

- [ ] Seleção de idioma preferido nas configurações do usuário
- [ ] Na página do livro: mostrar edições disponíveis em outros idiomas (base já preparada com `google_ids`)
- [ ] Filtro por tropes na tela Explorar (infraestrutura já existe)
- [ ] Recomendações por similaridade de tropes
- [ ] Busca por trope fora do catálogo (descoberta de livros novos)

### Longo prazo

- [ ] Score de relevância na busca usando `view_count` e `save_count` de `books` (hoje ainda usa legado de `books_catalog`)
- [ ] Explorar / descoberta de livros fora da estante

---

## Como Trabalhar

- Você descreve o problema ou a feature – pensamos juntos antes de partir pro código
- Sem código nas respostas – prompts formulados aqui, executados no Claude Code
- Um prompt por vez – testa e confirma antes do próximo
- Sempre incluir "faz commit e push" no final dos prompts pro Claude Code
- Quando precisar entender o estado atual do código, pede pro Claude Code explicar um fluxo específico e cola a resposta aqui
