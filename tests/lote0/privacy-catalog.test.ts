import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Lote 0 — Catálogo de Dados Proibidos na Fixture', () => {
  const fixturePath = resolve(__dirname, '../../fixtures/v1-synthetic-fixture.ffr.json');
  const rawFixture = readFileSync(fixturePath, 'utf-8');

  it('não contém CPFs reais ou formatados sem redação', () => {
    // Regex de CPF: 3 dígitos, ponto, 3 dígitos, ponto, 3 dígitos, hífen, 2 dígitos
    const cpfRegex = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
    expect(cpfRegex.test(rawFixture)).toBe(false);
  });

  it('não contém CNPJs reais ou formatados sem redação', () => {
    const cnpjRegex = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
    expect(cnpjRegex.test(rawFixture)).toBe(false);
  });

  it('não contém números de cartão de crédito sem redação', () => {
    // Sequências de 13 a 19 dígitos
    const cardRegex = /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/;
    expect(cardRegex.test(rawFixture)).toBe(false);
  });

  it('não contém e-mails reais ou não-redigidos', () => {
    // Procura qualquer e-mail no formato foo@bar.baz (exceto menções em docs/schemas)
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    expect(emailRegex.test(rawFixture)).toBe(false);
  });

  it('não contém tokens Bearer ou Basic em texto aberto', () => {
    // Se houver "Bearer", deve estar acompanhado de [REDACTED_...]
    const unredactedBearer = /Bearer\s+(?!\[REDACTED)[A-Za-z0-9\-_=.]+/i;
    expect(unredactedBearer.test(rawFixture)).toBe(false);
  });

  it('não contém senhas, secrets ou chaves de API não redigidas', () => {
    const prohibitedKeys = [
      '"password":\\s*"(?!\\[REDACTED)',
      '"senha":\\s*"(?!\\[REDACTED)',
      '"secret":\\s*"(?!\\[REDACTED)',
      '"apiKey":\\s*"(?!\\[REDACTED)',
      '"cvv":\\s*"(?!\\[REDACTED)'
    ];

    for (const pattern of prohibitedKeys) {
      const regex = new RegExp(pattern, 'i');
      expect(regex.test(rawFixture)).toBe(false);
    }
  });
});
