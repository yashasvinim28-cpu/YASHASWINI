import { useEffect, useRef } from "react";

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve(true);

  return new Promise((resolve) => {
    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

export default function GoogleAuthButton({ onCredential, disabled = false }) {
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      if (!clientId || !containerRef.current) return;

      const loaded = await loadGoogleScript();
      if (!loaded || cancelled || !window.google?.accounts?.id) return;

      containerRef.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (!cancelled && response?.credential) {
            onCredential?.(response.credential);
          }
        },
      });

      window.google.accounts.id.renderButton(containerRef.current, {
        theme: "outline",
        size: "large",
        width: 320,
        text: "continue_with",
        shape: "pill",
      });
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [onCredential]);

  return (
    <div style={{ opacity: disabled ? 0.6 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      <div ref={containerRef} />
    </div>
  );
}
