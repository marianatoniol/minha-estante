import { describe, it, expect } from 'vitest'
import { getGradient, getSimilarity, filterBooks, COVER_GRADIENTS } from './utils.js'

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
})
