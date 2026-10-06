// Order matters: keys before emails/amounts, so a token holding an @ or $ is masked whole.
const RULES: [RegExp, string][] = [
  [/\b(?:sk-(?:ant-|proj-)?[\w-]{16,}|gh[pousr]_\w{20,}|github_pat_\w{20,}|AKIA[0-9A-Z]{16}|xox[abpr]-[\w-]{10,}|AIza[\w-]{30,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})/g, '[key]'],
  [/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*)(\s*[=:]\s*)(["']?)[^\s"']{6,}\3/g, '$1$2[key]'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  [/(?:[$€£]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d\s]*(?:[.,]\d+)?\s?(?:zł|PLN|USD|EUR)(?![A-Za-z]))/g, '[kwota]'],
  [/\/Users\/[^/\s"']+/g, '~'],
]

export function mask(text: string): string {
  return RULES.reduce((s, [re, to]) => s.replace(re, to), text)
}

export function maskDeep(v: unknown): unknown {
  if (typeof v === 'string') return mask(v)
  if (Array.isArray(v)) return v.map(maskDeep)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)]))
  }
  return v
}
