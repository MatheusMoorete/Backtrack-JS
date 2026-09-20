const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'password',
  'senha',
  'token',
  'authorization',
  'cookie',
  'secret',
  'cvv',
  'cvc',
  'card',
  'credit',
  'cardnumber',
  'securitycode',
  'cpf',
  'cnpj',
  'email',
  'phone',
  'telefone',
  'celular',
  'otp',
  'verificationcode',
  'recoverycode',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'pin'
]);

// Expressões regulares para redação de strings sensíveis
const PATTERN_BEARER = /Bearer\s+[A-Za-z0-9\-_=.]+/gi;
const PATTERN_BASIC = /Basic\s+[A-Za-z0-9+/=]+/gi;
const PATTERN_JWT = /eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]*/gi;
const PATTERN_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PATTERN_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const PATTERN_CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const PATTERN_CREDIT_CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const PATTERN_PHONE = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\d{4}|\d{4})[ -]?\d{4}/g;

// Regex para IDs em URL
const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_NUMERIC_ID_REGEX = /\b\d{6,}\b/g;

export interface SanitizerConfig {
  maxDepth?: number;
  maxKeys?: number;
  maxItems?: number;
  maxStringLength?: number;
  sanitizeUrlCallback?: (url: URL) => string;
}

const DEFAULT_CONFIG: Required<Omit<SanitizerConfig, 'sanitizeUrlCallback'>> = {
  maxDepth: 4,
  maxKeys: 50,
  maxItems: 50,
  maxStringLength: 500
};

/**
 * Sanitiza uma URL conforme a seção 12.4 do SPEC.md:
 * - Remove fragment (#...)
 * - Preserva origin e pathname
 * - Preserva apenas os NOMES dos query parameters (ordenados, sem valores)
 * - Substitui UUIDs e IDs numéricos longos por :id
 */
export function sanitizeUrl(rawUrl: string, customCallback?: (url: URL) => string): string {
  try {
    const parsed = new URL(rawUrl, 'http://localhost');

    if (customCallback) {
      return customCallback(parsed);
    }

    // Preserva origin (se não for base virtual) e pathname
    let path = parsed.pathname;

    // Substitui UUIDs e IDs longos por :id
    path = path.replace(UUID_REGEX, ':id');
    path = path.replace(LONG_NUMERIC_ID_REGEX, ':id');

    // Nomes ordenados de query params (sem valores)
    const paramNames = Array.from(new Set(parsed.searchParams.keys())).sort();
    const queryString = paramNames.length > 0 ? `?${paramNames.join('&')}` : '';

    const isRelative = !rawUrl.startsWith('http://') && !rawUrl.startsWith('https://');
    if (isRelative) {
      return `${path}${queryString}`;
    }

    return `${parsed.origin}${path}${queryString}`;
  } catch {
    return '[INVALID_URL]';
  }
}

/**
 * Redige padrões reconhecíveis de segredos em texto puro.
 */
export function redactSensitiveString(str: string): string {
  if (!str || typeof str !== 'string') return str;

  let result = str;
  result = result.replace(PATTERN_BEARER, 'Bearer [REDACTED_TOKEN]');
  result = result.replace(PATTERN_BASIC, 'Basic [REDACTED_BASIC]');
  result = result.replace(PATTERN_JWT, '[REDACTED_JWT]');
  result = result.replace(PATTERN_EMAIL, '[REDACTED_EMAIL]');
  result = result.replace(PATTERN_CPF, '[REDACTED_CPF]');
  result = result.replace(PATTERN_CNPJ, '[REDACTED_CNPJ]');
  result = result.replace(PATTERN_CREDIT_CARD, '[REDACTED_CARD]');
  result = result.replace(PATTERN_PHONE, '[REDACTED_PHONE]');

  return result;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const s of SENSITIVE_KEYS) {
    if (normalized.includes(s)) return true;
  }
  return false;
}

/**
 * Serializador e sanitizador universal à prova de falhas:
 * - Detecta ciclos circulares
 * - Limita profundidade, chaves e tamanho de strings
 * - Redige propriedades e valores sensíveis
 * - Suporta Error, BigInt, Function, DOM elements e primitivos
 * - NUNCA lança exceção (operação total)
 */
export function sanitizeAndSerialize(input: unknown, config?: SanitizerConfig): unknown {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const seen = new WeakSet<object>();

  function walk(value: unknown, depth: number): unknown {
    try {
      if (value === null || value === undefined) {
        return value;
      }

      if (typeof value === 'boolean') {
        return value;
      }

      if (typeof value === 'number') {
        return Number.isNaN(value) ? '[NaN]' : value;
      }

      if (typeof value === 'bigint') {
        return `${value.toString()}n`;
      }

      if (typeof value === 'function') {
        return `[Function: ${value.name || 'anonymous'}]`;
      }

      if (typeof value === 'symbol') {
        return value.toString();
      }

      if (typeof value === 'string') {
        let str = redactSensitiveString(value);
        if (str.length > cfg.maxStringLength) {
          str = `${str.substring(0, cfg.maxStringLength)}... [TRUNCATED]`;
        }
        return str;
      }

      if (typeof value === 'object') {
        if (seen.has(value)) {
          return '[CIRCULAR]';
        }
        seen.add(value);

        if (depth >= cfg.maxDepth) {
          return '[MAX_DEPTH]';
        }

        // Caso especial: Error
        if (value instanceof Error) {
          return {
            name: value.name,
            message: redactSensitiveString(value.message),
            stack: value.stack ? redactSensitiveString(value.stack) : undefined
          };
        }

        // Caso especial: Date
        if (value instanceof Date) {
          return value.toISOString();
        }

        // Caso especial: RegExp
        if (value instanceof RegExp) {
          return value.toString();
        }

        // Caso especial: DOM Node / Element
        if (
          typeof (value as { nodeType?: number }).nodeType === 'number' &&
          typeof (value as { tagName?: string }).tagName === 'string'
        ) {
          const el = value as { tagName: string; id?: string; className?: string };
          return `<${el.tagName.toLowerCase()}${el.id ? ` id="${el.id}"` : ''}${el.className ? ` class="${el.className}"` : ''}>`;
        }

        // Array
        if (Array.isArray(value)) {
          const items: unknown[] = [];
          const length = Math.min(value.length, cfg.maxItems);
          for (let i = 0; i < length; i++) {
            items.push(walk(value[i], depth + 1));
          }
          if (value.length > cfg.maxItems) {
            items.push(`... [${value.length - cfg.maxItems} more items TRUNCATED]`);
          }
          return items;
        }

        // Objeto genérico
        const obj = value as Record<string, unknown>;
        const result: Record<string, unknown> = {};
        const keys = Object.keys(obj);
        const count = Math.min(keys.length, cfg.maxKeys);

        for (let i = 0; i < count; i++) {
          const k = keys[i];
          if (isSensitiveKey(k)) {
            result[k] = '[REDACTED]';
          } else {
            try {
              result[k] = walk(obj[k], depth + 1);
            } catch {
              result[k] = '[GETTER_ERROR]';
            }
          }
        }

        if (keys.length > cfg.maxKeys) {
          result['__truncated__'] = `[${keys.length - cfg.maxKeys} more keys TRUNCATED]`;
        }

        return result;
      }

      return '[UNRECOGNIZED_VALUE]';
    } catch {
      return '[SERIALIZATION_ERROR]';
    }
  }

  try {
    return walk(input, 0);
  } catch {
    return '[SERIALIZATION_FAILED]';
  }
}
