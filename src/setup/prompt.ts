export interface RequiredValuePrompter {
  text(label: string, defaultValue?: string): Promise<string>
  secret(label: string): Promise<string>
}

export async function askRequired(
  prompter: RequiredValuePrompter,
  label: string,
  initial?: string,
  secret = false,
): Promise<string> {
  const defaultValue = initial?.trim() || undefined
  if (secret && defaultValue !== undefined) return defaultValue

  while (true) {
    const value = secret
      ? (await prompter.secret(label)).trim()
      : (await prompter.text(label, defaultValue)).trim()
    if (value !== '') return value
    process.stdout.write('此项不能为空，请重新输入。\n')
  }
}
