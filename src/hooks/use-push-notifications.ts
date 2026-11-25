import { useCallback, useEffect, useRef, useState } from "react";
import OneSignal from "react-onesignal";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Role = "admin" | "cliente";

interface UsePushOptions {
  role: Role;
  userId?: string | null;
  /** auto-init OneSignal SDK on mount (does NOT request permission) */
  autoInit?: boolean;
}

let initPromise: Promise<void> | null = null;
let cachedAppId: string | null = null;

async function fetchAppId(): Promise<string> {
  if (cachedAppId) return cachedAppId;
  const envAppId = (import.meta.env.VITE_ONESIGNAL_APP_ID as string | undefined)?.trim();
  if (envAppId) {
    cachedAppId = envAppId;
    return envAppId;
  }
  try {
    const { data, error } = await supabase.functions.invoke("onesignal-config");
    if (!error && data?.appId) {
      cachedAppId = data.appId;
      return data.appId;
    }
  } catch {}
  return "041f606d-7c4d-42ce-8491-d6c358d7bba4";
}

async function initOneSignal(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const appId = await fetchAppId();
    await OneSignal.init({
      appId,
      safari_web_id: (import.meta.env.VITE_ONESIGNAL_SAFARI_WEB_ID as string | undefined)?.trim() || "web.onesignal.auto.38b1a4de-a361-440e-ae28-b71c05790af2",
      allowLocalhostAsSecureOrigin: true,
      serviceWorkerParam: { scope: "/" },
      serviceWorkerPath: "OneSignalSDKWorker.js",
      // A boas-vindas é enviada uma única vez por showWelcomeNotificationOnce()
      welcomeNotification: {
        disable: true,
      },
    } as any);
  })();
  return initPromise;
}

const PUSH_STATE_EVENT = "push-state-changed";
const WELCOME_STORAGE_KEY = "push-welcome-sent-v1";

function notifyPushStateChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PUSH_STATE_EVENT));
}

/** Envia UMA única notificação de boas-vindas por dispositivo (dedupe por storage + tag). */
async function showWelcomeNotificationOnce(playerId: string): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    if (localStorage.getItem(WELCOME_STORAGE_KEY) === playerId) return;
    localStorage.setItem(WELCOME_STORAGE_KEY, playerId);
  } catch {
    // storage indisponível: segue só com a tag para deduplicar
  }
  // O iOS já mostra "from Fernanda Hahn" (nome do app) acima do título.
  // Usamos o caractere invisível U+3164 (Hangul Filler) como título para ficar "sem título".
  const title = "\u3164";
  const options: NotificationOptions = {
    body: "Notificações ativadas! Você receberá confirmações e lembretes dos seus agendamentos por aqui. ✨",
    icon: "/icon-512.png",
    badge: "/icon-512.png",
    tag: "welcome-push",
  };
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
  } catch (err) {
    console.warn("Falha ao exibir boas-vindas:", err);
  }
}

function isLovablePreview(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host.includes("id-preview--") || host.includes("lovableproject.com");
}

function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;
  // Only block the Lovable preview iframe — real domains in iframes (rare) still try.
  if (isLovablePreview() && isInIframe()) return false;
  return true;
}

export function isPushPreviewBlocked(): boolean {
  return isLovablePreview() && isInIframe();
}

export function usePushNotifications({ role, userId, autoInit = true }: UsePushOptions) {
  const [supported] = useState(() => isSupported());
  const [permission, setPermission] = useState<NotificationPermission | "default">(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const initStarted = useRef(false);

  const refreshState = useCallback(async () => {
    try {
      const id = OneSignal.User?.PushSubscription?.id ?? null;
      const optedIn = OneSignal.User?.PushSubscription?.optedIn ?? false;
      setPlayerId(id);
      setSubscribed(!!optedIn && !!id);
      if (typeof Notification !== "undefined") setPermission(Notification.permission);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!supported || !autoInit || initStarted.current) return;
    initStarted.current = true;
    initOneSignal()
      .then(() => refreshState())
      .catch((e) => console.warn("OneSignal init failed:", e));
  }, [supported, autoInit, refreshState]);

  // Mantém todas as instâncias do hook (pop-up, botão do perfil, etc.) sincronizadas:
  // ativar pelo pop-up já deixa o botão do perfil marcado como "ativado".
  useEffect(() => {
    if (!supported) return;
    const onChange = () => { refreshState(); };
    window.addEventListener(PUSH_STATE_EVENT, onChange);

    let removeSdkListener: (() => void) | null = null;
    initPromise?.then(() => {
      try {
        const handler = () => { refreshState(); };
        OneSignal.User.PushSubscription.addEventListener("change", handler);
        removeSdkListener = () => OneSignal.User.PushSubscription.removeEventListener("change", handler);
      } catch {
        // ignore
      }
    }).catch(() => {});

    return () => {
      window.removeEventListener(PUSH_STATE_EVENT, onChange);
      removeSdkListener?.();
    };
  }, [supported, autoInit, refreshState]);

  const savePlayerId = useCallback(
    async (id: string) => {
      const deviceInfo = {
        ua: navigator.userAgent,
        lang: navigator.language,
        platform: (navigator as any).userAgentData?.platform ?? "",
      };
      // Upsert by player_id (unique)
      const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
          {
            player_id: id,
            role,
            user_id: userId ?? null,
            device_info: deviceInfo,
            ativo: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "player_id" }
        );
      if (error) console.error("Falha ao salvar player_id:", error);
    },
    [role, userId]
  );

  useEffect(() => {
    if (!supported || !userId) return;

    const currentId = OneSignal.User?.PushSubscription?.id ?? playerId;
    const optedIn = OneSignal.User?.PushSubscription?.optedIn ?? subscribed;

    if (!currentId || !optedIn) return;

    savePlayerId(currentId).catch((error) => {
      console.error("Falha ao vincular player_id ao usuário:", error);
    });
  }, [supported, userId, playerId, subscribed, savePlayerId]);

  const enable = useCallback(async () => {
    if (!supported) {
      toast.error("Push não suportado neste dispositivo/navegador.");
      return false;
    }
    setLoading(true);
    try {
      await initOneSignal();
      // Solicita permissão nativa
      await OneSignal.Notifications.requestPermission();
      // opt-in subscription
      await OneSignal.User.PushSubscription.optIn();

      // Aguarda o player_id ficar disponível (até 5s)
      let id = OneSignal.User?.PushSubscription?.id ?? null;
      for (let i = 0; i < 10 && !id; i++) {
        await new Promise((r) => setTimeout(r, 500));
        id = OneSignal.User?.PushSubscription?.id ?? null;
      }

      if (!id) {
        toast.error("Não foi possível registrar o dispositivo. Tente novamente.");
        return false;
      }

      await savePlayerId(id);
      await refreshState();

      await showWelcomeNotificationOnce(id);
      notifyPushStateChanged();

      toast.success("🔔 Notificações ativadas!");
      return true;
    } catch (e) {
      console.error(e);
      toast.error("Erro ao ativar notificações.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [supported, savePlayerId, refreshState]);

  const disable = useCallback(async () => {
    setLoading(true);
    try {
      await OneSignal.User.PushSubscription.optOut();
      const id = playerId;
      if (id) {
        await supabase
          .from("push_subscriptions")
          .update({ ativo: false })
          .eq("player_id", id);
      }
      await refreshState();
      notifyPushStateChanged();
      toast.success("Notificações desativadas.");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [playerId, refreshState]);

  return {
    supported,
    permission,
    subscribed,
    loading,
    playerId,
    enable,
    disable,
  };
}
