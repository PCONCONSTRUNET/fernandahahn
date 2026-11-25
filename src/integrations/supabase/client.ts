import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const isTestEnv = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
const envUrl = !isTestEnv ? (import.meta.env.VITE_SUPABASE_URL?.trim() || '') : '';
const envKey = !isTestEnv ? (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || '') : '';

export const isSupabaseConfigured = Boolean(envUrl && envKey);
export const SUPABASE_URL = envUrl;
export const SUPABASE_PUBLISHABLE_KEY = envKey;

// Quando o .env ainda está desconectado, evita travar abas em "Carregando..." tentando resolver placeholder.supabase.co
const offlineSafeFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
  const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const headersObj = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  const accept = headersObj.get("accept") || "";

  if (method === "GET" && url.includes("/rest/v1/")) {
    const isSingle = accept.includes("application/vnd.pgrst.object+json");
    return new Response(JSON.stringify(isSingle ? null : []), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-range": "0-0/0",
      },
    });
  }

  return new Response(
    JSON.stringify({
      error: "SUPABASE_NOT_CONFIGURED",
      message: "Supabase ainda não configurado no .env",
    }),
    {
      status: 503,
      headers: { "content-type": "application/json" },
    }
  );
};

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(
  envUrl || 'https://placeholder.supabase.co',
  envKey || 'placeholder-anon-key',
  {
    auth: {
      storage: localStorage,
      persistSession: isSupabaseConfigured,
      autoRefreshToken: isSupabaseConfigured,
    },
    realtime: {
      // Heartbeat reduzido ao máximo para minimizar tráfego keep-alive no NANO
      heartbeatIntervalMs: 60000,
      // Limita eventos processados por segundo (evita picos de I/O no NANO)
      eventsPerSecond: 2,
      // Timeout maior para reconexão — evita loop de reconnect que abre novas conexões
      reconnectAfterMs: (tries: number) => Math.min(tries * 2000, 30000),
    },
    db: {
      schema: 'public',
    },
    global: {
      ...(isSupabaseConfigured ? {} : { fetch: offlineSafeFetch }),
      headers: {
        'x-connection-encrypted': 'true',
      },
    },
  }
);