import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce } from '@/utils/debounce'

let fn: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  fn = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('debounce', () => {
  it('does not call through before the wait elapses', () => {
    const wrapped = debounce(fn, 300)
    wrapped('a')
    vi.advanceTimersByTime(299)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('coalesces a burst into one call with the last arguments', () => {
    const wrapped = debounce(fn, 200)
    wrapped('first')
    wrapped('second')
    wrapped('third')
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('third')
  })

  it('restarts the timer on every call', () => {
    const wrapped = debounce(fn, 100)
    wrapped(1)
    vi.advanceTimersByTime(90)
    wrapped(2)
    vi.advanceTimersByTime(90)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10)
    expect(fn).toHaveBeenCalledWith(2)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('passes through multiple arguments and repeated invocations', () => {
    const wrapped = debounce(fn, 50)
    wrapped('a', 1, true)
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledWith('a', 1, true)

    wrapped('b', 2, false)
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('b', 2, false)
  })

  it('fires again after the first call settled', () => {
    const wrapped = debounce(fn, 100)
    wrapped()
    vi.advanceTimersByTime(100)
    wrapped()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cancel() drops a pending call', () => {
    const wrapped = debounce(fn, 100)
    wrapped()
    wrapped.cancel()
    vi.advanceTimersByTime(1_000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancel() is safe when nothing is pending, before and after a fire', () => {
    const wrapped = debounce(fn, 100)
    expect(() => wrapped.cancel()).not.toThrow()

    wrapped()
    vi.advanceTimersByTime(100)
    expect(() => {
      wrapped.cancel()
      wrapped.cancel()
    }).not.toThrow()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('can be reused after cancel()', () => {
    const wrapped = debounce(fn, 100)
    wrapped('dropped')
    wrapped.cancel()
    wrapped('kept')
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('kept')
  })

  it('debounces each wrapper independently', () => {
    const other = vi.fn()
    const a = debounce(fn, 100)
    const b = debounce(other, 300)
    a()
    b()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(other).toHaveBeenCalledTimes(1)
  })

  it('honours a zero wait as a macrotask deferral, not a sync call', () => {
    const wrapped = debounce(fn, 0)
    wrapped()
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel() affects only its own wrapper', () => {
    const other = vi.fn()
    const a = debounce(fn, 100)
    const b = debounce(other, 100)
    a()
    b()
    a.cancel()
    vi.advanceTimersByTime(100)
    expect(fn).not.toHaveBeenCalled()
    expect(other).toHaveBeenCalledTimes(1)
  })
})
