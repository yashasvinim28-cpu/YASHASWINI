import { useEffect, useRef } from "react";
import { fetchWithAuth } from "../utils/api";
import { notificationMessage } from "../utils/notificationMessage";

export function useNotifications(user, showToast) {
  const seenRef = useRef(new Set());
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  useEffect(() => {
    if (!user?.id) return undefined;
    let stopped = false;
    let busy = false;

    async function poll() {
      if (busy || stopped) return;
      busy = true;
      try {
        const { data } = await fetchWithAuth("/notifications/my");
        const unread = Array.isArray(data) ? data : [];
        for (const item of unread) {
          if (stopped) break;
          if (seenRef.current.has(item.id)) continue;
          seenRef.current.add(item.id);
          toastRef.current(notificationMessage(item));
          await fetchWithAuth(`/notifications/${item.id}/read`, { method: "PATCH" });
        }
      } catch {
        // Keep polling so temporary API failures do not discard notifications.
      } finally {
        busy = false;
      }
    }

    poll();
    const timer = window.setInterval(poll, 10000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [user?.id]);
}
