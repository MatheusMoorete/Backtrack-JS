export interface SessionContext {
  tabId: string;
  sessionId: string;
}

const TAB_ID_KEY = '__backtrack_tab_id__';
const SESSION_ID_KEY = '__backtrack_session_id__';
const LEGACY_TAB_ID_KEY = '__ffr_tab_id__';
const LEGACY_SESSION_ID_KEY = '__ffr_session_id__';

function generateRandomId(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}_${rand}`;
}

/**
 * Obtém ou inicializa o tabId e sessionId da aba atual utilizando sessionStorage.
 * Sobrevive a F5/reload na mesma aba sem vazar para outras abas.
 */
export function getOrCreateSessionContext(storage?: Storage): SessionContext {
  const store = storage || (typeof window !== 'undefined' ? window.sessionStorage : undefined);

  if (!store) {
    return {
      tabId: generateRandomId('tab'),
      sessionId: generateRandomId('sess')
    };
  }

  let tabId = store.getItem(TAB_ID_KEY) || store.getItem(LEGACY_TAB_ID_KEY);
  if (!tabId) {
    tabId = generateRandomId('tab');
    try {
      store.setItem(TAB_ID_KEY, tabId);
    } catch {
      // Ignora erro se sessionStorage estiver restrito
    }
  }

  let sessionId = store.getItem(SESSION_ID_KEY) || store.getItem(LEGACY_SESSION_ID_KEY);
  if (!sessionId) {
    sessionId = generateRandomId('sess');
    try {
      store.setItem(SESSION_ID_KEY, sessionId);
    } catch {
      // Ignora erro se sessionStorage estiver restrito
    }
  }

  return { tabId, sessionId };
}

/**
 * Força a renovação da sessão (útil para testes ou reinicialização explícita).
 */
export function resetSessionContext(storage?: Storage): SessionContext {
  const store = storage || (typeof window !== 'undefined' ? window.sessionStorage : undefined);
  if (store) {
    try {
      store.removeItem(TAB_ID_KEY);
      store.removeItem(SESSION_ID_KEY);
      store.removeItem(LEGACY_TAB_ID_KEY);
      store.removeItem(LEGACY_SESSION_ID_KEY);
    } catch {
      // Noop
    }
  }
  return getOrCreateSessionContext(storage);
}
