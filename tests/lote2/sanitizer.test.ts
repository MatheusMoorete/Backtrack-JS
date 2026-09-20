import { describe, it, expect } from 'vitest';
import { sanitizeAndSerialize, sanitizeUrl, redactSensitiveString } from '../../src/capturers/sanitizer';

describe('Lote 2 — Sanitizador e Serializador Universal', () => {
  it('remove query values e preserva nomes ordenados em URLs', () => {
    const raw = 'https://api.uticket.com.br/events/1234567?email=user@test.com&token=secret123&code=445';
    const sanitized = sanitizeUrl(raw);
    expect(sanitized).toBe('https://api.uticket.com.br/events/:id?code&email&token');
    expect(sanitized.includes('user@test.com')).toBe(false);
    expect(sanitized.includes('secret123')).toBe(false);
  });

  it('substitui UUIDs e IDs numéricos longos por :id na URL', () => {
    const raw = 'https://api.uticket.com.br/orders/550e8400-e29b-41d4-a716-446655440000/items/99887766';
    const sanitized = sanitizeUrl(raw);
    expect(sanitized).toBe('https://api.uticket.com.br/orders/:id/items/:id');
  });

  it('redige tokens Bearer, Basic e JWT em strings', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThis and Basic dXNlcjpwYXNz';
    const redacted = redactSensitiveString(text);
    expect(redacted).not.toContain('eyJhbGci');
    expect(redacted).not.toContain('dXNlcjpwYXNz');
    expect(redacted).toContain('Bearer [REDACTED_TOKEN]');
    expect(redacted).toContain('Basic [REDACTED_BASIC]');
  });

  it('redige e-mails, CPFs e números de cartão em strings', () => {
    const text = 'Cliente 123.456.789-01 com cartao 4111 2222 3333 4444 e email joao.silva@exemplo.com.br';
    const redacted = redactSensitiveString(text);
    expect(redacted).not.toContain('123.456.789-01');
    expect(redacted).not.toContain('4111 2222 3333 4444');
    expect(redacted).not.toContain('joao.silva@exemplo.com.br');
    expect(redacted).toContain('[REDACTED_CPF]');
    expect(redacted).toContain('[REDACTED_CARD]');
    expect(redacted).toContain('[REDACTED_EMAIL]');
  });

  it('redige propriedades sensíveis em objetos (case-insensitive)', () => {
    const payload = {
      user: {
        name: 'Maria Teste',
        Password: 'superSecretPassword123',
        cpf: '11122233344',
        otp_code: '984123',
        card: '4111222233334444',
        paymentInfo: {
          cvv: '123',
          securityCode: '999',
          cardNumber: '1234123412341234',
          holder: 'Maria Teste'
        }
      }
    };

    const sanitized = sanitizeAndSerialize(payload) as Record<string, unknown>;
    const user = sanitized.user as Record<string, unknown>;

    expect(user.name).toBe('Maria Teste');
    expect(user.Password).toBe('[REDACTED]');
    expect(user.cpf).toBe('[REDACTED]');
    expect(user.otp_code).toBe('[REDACTED]');
    expect(user.card).toBe('[REDACTED]');

    const paymentInfo = user.paymentInfo as Record<string, unknown>;
    expect(paymentInfo.cvv).toBe('[REDACTED]');
    expect(paymentInfo.securityCode).toBe('[REDACTED]');
    expect(paymentInfo.cardNumber).toBe('[REDACTED]');
    expect(paymentInfo.holder).toBe('Maria Teste');
  });

  it('lida graciosamente com objetos circulares', () => {
    const parent: Record<string, unknown> = { name: 'parent' };
    const child: Record<string, unknown> = { name: 'child', parent };
    parent.child = child;

    const sanitized = sanitizeAndSerialize(parent) as Record<string, unknown>;
    expect(sanitized.name).toBe('parent');
    expect((sanitized.child as Record<string, unknown>).name).toBe('child');
    expect(((sanitized.child as Record<string, unknown>).parent as string)).toBe('[CIRCULAR]');
  });

  it('lida com getters que lançam erro sem quebrar', () => {
    const hostileObj = {
      normal: 'ok',
      get thrower() {
        throw new Error('Hostile getter triggered');
      }
    };

    const sanitized = sanitizeAndSerialize(hostileObj);
    expect(sanitized).toBeDefined();
    expect((sanitized as Record<string, unknown>).normal).toBe('ok');
  });

  it('limita profundidade máxima (maxDepth)', () => {
    const deepObj = {
      l1: {
        l2: {
          l3: {
            l4: {
              l5: 'deep'
            }
          }
        }
      }
    };

    const sanitized = sanitizeAndSerialize(deepObj, { maxDepth: 3 });
    const l1 = (sanitized as Record<string, unknown>).l1 as Record<string, unknown>;
    const l2 = l1.l2 as Record<string, unknown>;
    const l3 = l2.l3 as Record<string, unknown>;
    expect(l3).toBe('[MAX_DEPTH]');
  });

  it('suporta instâncias de Error preservando name, message e stack redigidos', () => {
    const err = new Error('Token inválido: Bearer secretToken999');
    const sanitized = sanitizeAndSerialize(err) as { name: string; message: string; stack?: string };

    expect(sanitized.name).toBe('Error');
    expect(sanitized.message).toBe('Token inválido: Bearer [REDACTED_TOKEN]');
    expect(sanitized.stack).toBeDefined();
    expect(sanitized.stack).not.toContain('secretToken999');
  });
});
