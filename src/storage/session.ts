export interface SessionContext {
  tabId: string;
  sessionId: string;
}

const TAB_ID_KEY = '__backtrack_tab_id__';
const SESSION_ID_KEY = '__backtrack_session_id__';
const LEGACY_TAB_ID_KEY = '__ffr_tab_id__';
const LEGACY_SESSION_ID_KEY = '__ffr_session_id__';
const BROADCAST_CHANNEL_NAME = '__backtrack_session_channel__';

interface SessionBroadcastMessage {
  type: 'CLAIM_TAB_ID' | 'TAB_ID_COLLISION';
  tabId: string;
  claimId: string;
}

export interface ClaimSessionOptions {
  storage?: Storage;
  timeoutMs?: number;
  channelName?: string;
  channel?: BroadcastChannel | null;
  disableBroadcastChannel?: boolean;
}

let activeSessionContext: SessionContext | null = null;
const activeChannels = new Set<BroadcastChannel>();

function generateRandomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return `${prefix}_${crypto.randomUUID()}`;
    } catch {
      // Fallback abaixo
    }
  }
  const rand = Math.random().toString(36).substring(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}_${rand}`;
}

function setupActiveTabListener(channel: BroadcastChannel, tabId: string): void {
  activeChannels.add(channel);
  channel.addEventListener('message', (event: MessageEvent<SessionBroadcastMessage>) => {
    const data = event.data;
    if (data && data.type === 'CLAIM_TAB_ID' && data.tabId === tabId) {
      try {
        channel.postMessage({
          type: 'TAB_ID_COLLISION',
          tabId,
          claimId: data.claimId
        });
      } catch {
        // Ignora se o canal já tiver sido fechado
      }
    }
  });
}

/**
 * Fecha os canais de BroadcastChannel abertos pela sessão.
 */
export function closeSessionChannel(channel?: BroadcastChannel): void {
  if (channel) {
    try {
      channel.close();
    } catch {
      // Noop
    }
    activeChannels.delete(channel);
  } else {
    for (const ch of activeChannels) {
      try {
        ch.close();
      } catch {
        // Noop
      }
    }
    activeChannels.clear();
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => {
    closeSessionChannel();
  });
}

/**
 * Obtém ou inicializa o tabId e sessionId da aba atual utilizando sessionStorage.
 * Sobrevive a F5/reload na mesma aba sem vazar para outras abas.
 * Mantida versão síncrona para compatibilidade da API pública.
 */
export function getOrCreateSessionContext(storage?: Storage): SessionContext {
  if (!storage && activeSessionContext) {
    return { ...activeSessionContext };
  }

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
 * Confirma e reivindica a identidade da sessão da aba de forma assíncrona.
 * Se o storage tiver sido herdado por duplicação de aba e a aba original
 * ainda estiver ativa no BroadcastChannel, gera novos IDs para tabId e sessionId.
 */
export async function claimSessionContext(options?: ClaimSessionOptions): Promise<SessionContext> {
  const store = options?.storage || (typeof window !== 'undefined' ? window.sessionStorage : undefined);

  if (!store) {
    const fallback = {
      tabId: generateRandomId('tab'),
      sessionId: generateRandomId('sess')
    };
    activeSessionContext = fallback;
    return fallback;
  }

  let tabId = store.getItem(TAB_ID_KEY) || store.getItem(LEGACY_TAB_ID_KEY);
  let sessionId = store.getItem(SESSION_ID_KEY) || store.getItem(LEGACY_SESSION_ID_KEY);

  const canUseBroadcast =
    !options?.disableBroadcastChannel &&
    (Boolean(options?.channel) || (typeof BroadcastChannel !== 'undefined'));

  // Caso 1: Primeira inicialização da aba (nada no sessionStorage)
  if (!tabId) {
    tabId = generateRandomId('tab');
    sessionId = sessionId || generateRandomId('sess');
    try {
      store.setItem(TAB_ID_KEY, tabId);
      store.setItem(SESSION_ID_KEY, sessionId);
    } catch {
      // Ignora erro se sessionStorage estiver restrito
    }

    if (canUseBroadcast) {
      try {
        const channel =
          options?.channel || new BroadcastChannel(options?.channelName || BROADCAST_CHANNEL_NAME);
        setupActiveTabListener(channel, tabId);
      } catch {
        // Fallback gracioso se BroadcastChannel falhar ao instanciar
      }
    }

    const context = { tabId, sessionId };
    activeSessionContext = context;
    return context;
  }

  // Caso 2: tabId encontrado no storage. Pode ser reload OU aba duplicada.
  if (!canUseBroadcast) {
    // Sem BroadcastChannel, preserva storage existente como fallback
    sessionId = sessionId || generateRandomId('sess');
    try {
      store.setItem(SESSION_ID_KEY, sessionId);
    } catch {
      // Ignora
    }
    const context = { tabId, sessionId };
    activeSessionContext = context;
    return context;
  }

  // Com BroadcastChannel: anuncia o tabId para verificar se já há outra aba ativa com ele
  let channel: BroadcastChannel | null = null;
  try {
    channel =
      options?.channel || new BroadcastChannel(options?.channelName || BROADCAST_CHANNEL_NAME);
  } catch {
    // Fallback se não conseguir abrir o canal
    sessionId = sessionId || generateRandomId('sess');
    const context = { tabId, sessionId };
    activeSessionContext = context;
    return context;
  }

  const claimId = generateRandomId('claim');
  const timeoutMs = options?.timeoutMs ?? 50;
  let hasCollision = false;

  const collisionHandler = (event: MessageEvent<SessionBroadcastMessage>) => {
    const data = event.data;
    if (data && data.type === 'TAB_ID_COLLISION' && data.tabId === tabId && data.claimId === claimId) {
      hasCollision = true;
    }
  };

  channel.addEventListener('message', collisionHandler);

  try {
    channel.postMessage({
      type: 'CLAIM_TAB_ID',
      tabId,
      claimId
    });

    await new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    });
  } catch {
    // Se falhar no postMessage/timeout, assume sem colisão
  } finally {
    channel.removeEventListener('message', collisionHandler);
  }

  if (hasCollision) {
    // Aba duplicada detectada: gera novas identidades para não colidir com a aba original
    tabId = generateRandomId('tab');
    sessionId = generateRandomId('sess');
    try {
      store.setItem(TAB_ID_KEY, tabId);
      store.setItem(SESSION_ID_KEY, sessionId);
    } catch {
      // Ignora
    }
  } else {
    // Reload normal: a aba anterior foi descarregada, preserva IDs existentes
    if (!sessionId) {
      sessionId = generateRandomId('sess');
      try {
        store.setItem(SESSION_ID_KEY, sessionId);
      } catch {
        // Ignora
      }
    }
  }

  // Registra a aba atual como dona ativa desse tabId
  setupActiveTabListener(channel, tabId);

  const context = { tabId, sessionId };
  activeSessionContext = context;
  return context;
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
  activeSessionContext = null;
  closeSessionChannel();
  return getOrCreateSessionContext(storage);
}
