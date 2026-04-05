import { describe, it, expect } from 'vitest'
import { getGradient, getSimilarity, filterBooks, filterByExplore, buildRecommendations, normalizeBookRow, parseAIJson, COVER_GRADIENTS } from './utils.js'

// ─── getGradient ──────────────────────────────────────────────────────────────

describe('getGradient', () => {
  it('retorna um gradiente do array para um título normal', () => {
    const result = getGradient('Harry Potter')
    expect(COVER_GRADIENTS).toContain(result)
  })

  it('não lança erro com string vazia e retorna um gradiente válido', () => {
    const result = getGradient('')
    expect(COVER_GRADIENTS).toContain(result)
  })

  it('retorna sempre o mesmo gradiente para o mesmo título (determinístico)', () => {
    expect(getGradient('Duna')).toBe(getGradient('Duna'))
  })
})

// ─── getSimilarity ────────────────────────────────────────────────────────────

describe('getSimilarity', () => {
  it('calcula similaridade corretamente com tropes em comum', () => {
    // interseção: ['slow burn', 'enemies to lovers'] → 2 de 3 → ~67%
    const a = { tropes: ['slow burn', 'enemies to lovers'] }
    const b = { tropes: ['slow burn', 'enemies to lovers', 'found family'] }
    expect(getSimilarity(a, b)).toBe(67)
  })

  it('retorna 0 quando não há tropes em comum', () => {
    const a = { tropes: ['slow burn'] }
    const b = { tropes: ['found family'] }
    expect(getSimilarity(a, b)).toBe(0)
  })

  it('retorna 0 sem divisão por zero quando ambos têm tropes: undefined', () => {
    // a função usa `|| []` internamente: new Set(a.tropes || [])
    const a = { tropes: undefined }
    const b = { tropes: undefined }
    expect(getSimilarity(a, b)).toBe(0)
  })

  it('retorna 0 quando um livro tem tropes e o outro não tem nenhum', () => {
    const a = { tropes: ['slow burn', 'dark romance'] }
    const b = {}
    expect(getSimilarity(a, b)).toBe(0)
  })

  it('retorna 100 quando os dois livros têm exatamente os mesmos tropes', () => {
    const tropes = ['slow burn', 'enemies to lovers']
    const a = { tropes }
    const b = { tropes: [...tropes] }
    expect(getSimilarity(a, b)).toBe(100)
  })
})

// ─── filterBooks ─────────────────────────────────────────────────────────────

const books = [
  { title: 'Duna', authors: ['Frank Herbert'], status: 'lido', tropes: ['distopia'], genres: ['ficção científica'] },
  { title: 'Harry Potter', authors: ['J.K. Rowling'], status: 'lendo', tropes: ['academia de magia'], genres: ['fantasia'] },
  { title: 'A Cor da Magia', authors: ['Terry Pratchett'], status: 'quero ler', tropes: ['fantasia epica'], genres: ['fantasia'] },
]

describe('filterBooks', () => {
  it('sem filtro retorna todos os livros', () => {
    expect(filterBooks(books)).toHaveLength(3)
  })

  it('filtra por statusFilter corretamente', () => {
    const result = filterBooks(books, { statusFilter: 'lido' })
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Duna')
  })

  it('filtra por busca textual no título (case-insensitive)', () => {
    const result = filterBooks(books, { search: 'harry' })
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Harry Potter')
  })

  it('filtra por busca no nome do autor', () => {
    const result = filterBooks(books, { search: 'pratchett' })
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('A Cor da Magia')
  })

  it('retorna [] para lista vazia', () => {
    expect(filterBooks([], { statusFilter: 'lido' })).toEqual([])
  })

  it('retorna [] quando a busca não encontra nada', () => {
    expect(filterBooks(books, { search: 'tolkien' })).toEqual([])
  })

  it('combina statusFilter e search corretamente', () => {
    const result = filterBooks(books, { statusFilter: 'lendo', search: 'harry' })
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Harry Potter')
  })

  it('filtra por busca em tropes', () => {
    const result = filterBooks(books, { search: 'distopia' })
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Duna')
  })

  it('filtra por busca em gêneros', () => {
    const result = filterBooks(books, { search: 'fantasia' })
    expect(result).toHaveLength(2)
  })
})

// ─── filterByExplore ──────────────────────────────────────────────────────────

describe('filterByExplore', () => {
  it('sem filtro retorna todos os livros', () => {
    expect(filterByExplore(books)).toHaveLength(3)
  })

  it('filtra por gênero corretamente', () => {
    const result = filterByExplore(books, { selectedGenre: 'fantasia' })
    expect(result).toHaveLength(2)
    expect(result.map(b => b.title)).toEqual(['Harry Potter', 'A Cor da Magia'])
  })

  it('filtra por um único trope (AND)', () => {
    const result = filterByExplore(books, { selectedTropes: ['distopia'] })
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Duna')
  })

  it('exige TODOS os tropes selecionados (lógica AND)', () => {
    // nenhum livro tem os dois tropes ao mesmo tempo
    const result = filterByExplore(books, { selectedTropes: ['distopia', 'academia de magia'] })
    expect(result).toHaveLength(0)
  })

  it('combina gênero e tropes', () => {
    const result = filterByExplore(books, { selectedGenre: 'fantasia', selectedTropes: ['fantasia epica'] })
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('A Cor da Magia')
  })

  it('retorna [] para lista vazia', () => {
    expect(filterByExplore([], { selectedGenre: 'fantasia' })).toEqual([])
  })
})

// ─── buildRecommendations ─────────────────────────────────────────────────────

const recoBooks = [
  { id: 1, title: 'Livro A', tropes: ['slow burn', 'enemies to lovers', 'dark romance'] },
  { id: 2, title: 'Livro B', tropes: ['slow burn', 'enemies to lovers'] },
  { id: 3, title: 'Livro C', tropes: ['found family'] },
]

describe('buildRecommendations', () => {
  it('retorna recomendações ordenadas por similaridade decrescente', () => {
    const result = buildRecommendations(recoBooks)
    expect(result.length).toBeGreaterThan(0)
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].similarity).toBeGreaterThanOrEqual(result[i].similarity)
    }
  })

  it('não inclui pares abaixo do threshold padrão (30)', () => {
    // Livro C não tem tropes em comum com A ou B → similarity 0
    const result = buildRecommendations(recoBooks)
    expect(result.every(r => r.book.id !== 3)).toBe(true)
  })

  it('inclui pares acima de threshold personalizado', () => {
    // threshold 0 → todos os pares com tropes em comum entram
    const result = buildRecommendations(recoBooks, 0)
    const ids = result.map(r => r.book.id)
    expect(ids).toContain(2)
  })

  it('cada livro aparece no máximo uma vez como recomendação', () => {
    const result = buildRecommendations(recoBooks)
    const ids = result.map(r => r.book.id)
    expect(ids.length).toBe(new Set(ids).size)
  })

  it('retorna [] com lista vazia', () => {
    expect(buildRecommendations([])).toEqual([])
  })

  it('retorna [] com apenas um livro', () => {
    expect(buildRecommendations([recoBooks[0]])).toEqual([])
  })
})

// ─── normalizeBookRow ─────────────────────────────────────────────────────────

describe('normalizeBookRow', () => {
  it('mapeia corretamente uma linha completa do Supabase', () => {
    const row = {
      id: 'abc',
      status: 'lendo',
      rating: 4,
      added_at: '2024-01-01',
      books: {
        google_id: 'gid1', title: 'Duna', authors: ['Frank Herbert'],
        cover: 'http://img', description: 'Sinopse', page_count: 412,
        genres: ['ficção científica'], tropes: ['distopia'], summary: 'Resumo',
      },
    }
    expect(normalizeBookRow(row)).toEqual({
      id: 'abc', googleId: 'gid1', title: 'Duna', authors: ['Frank Herbert'],
      cover: 'http://img', description: 'Sinopse', pageCount: 412,
      genres: ['ficção científica'], tropes: ['distopia'], summary: 'Resumo',
      status: 'lendo', rating: 4, addedAt: '2024-01-01',
    })
  })

  it('aplica defaults quando books é null', () => {
    const row = { id: 'x', status: 'lido', rating: null, added_at: null, books: null }
    const result = normalizeBookRow(row)
    expect(result.title).toBe('')
    expect(result.authors).toEqual([])
    expect(result.genres).toEqual([])
    expect(result.tropes).toEqual([])
    expect(result.pageCount).toBe(0)
    expect(result.rating).toBe(0)
    expect(result.googleId).toBeNull()
    expect(result.cover).toBeNull()
  })
})

// ─── parseAIJson ──────────────────────────────────────────────────────────────

describe('parseAIJson', () => {
  it('faz parse de JSON limpo', () => {
    expect(parseAIJson('{"ok":true}')).toEqual({ ok: true })
  })

  it('remove bloco ```json``` antes de parsear', () => {
    expect(parseAIJson('```json\n{"ok":true}\n```')).toEqual({ ok: true })
  })

  it('remove bloco ``` sem linguagem', () => {
    expect(parseAIJson('```\n{"ok":true}\n```')).toEqual({ ok: true })
  })

  it('lança SyntaxError para JSON inválido', () => {
    expect(() => parseAIJson('não é json')).toThrow(SyntaxError)
  })
})
