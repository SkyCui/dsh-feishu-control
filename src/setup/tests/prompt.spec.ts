import { describe, expect, it, vi } from 'vitest'
import { askRequired, type RequiredValuePrompter } from '../prompt.ts'

function prompter(textAnswers: string[] = [], secretAnswers: string[] = []): RequiredValuePrompter {
  return {
    text: vi.fn(async (_label: string, defaultValue?: string) => textAnswers.shift() || defaultValue || ''),
    secret: vi.fn(async () => secretAnswers.shift() || ''),
  }
}

describe('setup required-value prompts', () => {
  it('prompts with an existing non-secret value so it can be replaced', async () => {
    const input = prompter(['ou_real'])

    await expect(askRequired(input, 'open_id', 'ou_placeholder')).resolves.toBe('ou_real')
    expect(input.text).toHaveBeenCalledWith('open_id', 'ou_placeholder')
  })

  it('keeps the existing non-secret value when the user presses Enter', async () => {
    const input = prompter([''])

    await expect(askRequired(input, 'open_id', 'ou_existing')).resolves.toBe('ou_existing')
  })

  it('reuses an existing secret without displaying or requesting it', async () => {
    const input = prompter()

    await expect(askRequired(input, 'App Secret', 'saved-secret', true)).resolves.toBe('saved-secret')
    expect(input.secret).not.toHaveBeenCalled()
  })
})
