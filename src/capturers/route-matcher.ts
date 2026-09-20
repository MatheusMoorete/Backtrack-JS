import type { RouteMatcher } from '../types/options';

/**
 * Converte um padrão de rota com wildcard (ex: '/checkout/*', '/auth/**') em RegExp.
 */
export function globToRegex(pattern: string): RegExp {
  if (pattern === '*' || pattern === '/*') {
    return /^.*$/;
  }

  // Normaliza barras
  const clean = pattern.startsWith('/') ? pattern : `/${pattern}`;

  // Escapa caracteres especiais de regex (exceto asteriscos)
  const escaped = clean.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  // Substitui ** por marcador temporário, * por [^/]+, e o marcador por .*
  const regexStr = escaped
    .replace(/\*\*/g, '§DOUBLE_STAR§')
    .replace(/\*/g, '[^/]+')
    .replace(/§DOUBLE_STAR§/g, '.*');

  return new RegExp(`^${regexStr}/?(?:\\?|#|$)`, 'i');
}

/**
 * Verifica se um pathname ou URL corresponde a alguma das regras de sensitiveRoutes configuradas.
 */
export function matchesSensitiveRoute(
  pathname: string,
  matchers?: RouteMatcher[]
): boolean {
  if (!matchers || matchers.length === 0) {
    return false;
  }

  // Normaliza pathname
  let normalized = pathname;
  try {
    if (pathname.includes('://')) {
      normalized = new URL(pathname).pathname;
    } else {
      normalized = pathname.split('?')[0].split('#')[0];
    }
  } catch {
    // Mantém pathname original caso não consiga parsear URL
  }

  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  for (const matcher of matchers) {
    if (typeof matcher === 'function') {
      try {
        if (matcher(normalized)) return true;
      } catch {
        // Ignora erros no predicado do usuário
      }
    } else if (matcher instanceof RegExp) {
      if (matcher.test(normalized)) return true;
    } else if (typeof matcher === 'string') {
      if (matcher === normalized) return true;
      const regex = globToRegex(matcher);
      if (regex.test(normalized)) return true;
    }
  }

  return false;
}
