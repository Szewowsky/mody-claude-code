import { expect, test } from 'claude-code/testing'

import { mask } from '../hooks/mask'

test('masks secrets, keeps prose', () => {
  expect(mask('pisz na szewczykrobert27@gmail.com')).toBe('pisz na [email]')
  expect(mask('OPENAI_API_KEY=sk-proj-abcdefghijklmnop1234')).toBe('OPENAI_API_KEY=[key]')
  expect(mask('token ghp_abcdefghijklmnopqrstuvwxyz12')).toBe('token [key]')
  expect(mask('koszt $12.22 i 49 zł')).toBe('koszt [kwota] i [kwota]')
  expect(mask('/Users/ola/Projekty')).toBe('~/Projekty')
  expect(mask('slice-22a ma 8% paddingu')).toBe('slice-22a ma 8% paddingu')
})
