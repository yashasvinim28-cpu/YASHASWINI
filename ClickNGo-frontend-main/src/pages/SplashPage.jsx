import { useEffect } from "react";

export default function SplashPage({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--yellow)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        animation: "fadeIn .3s ease",
      }}
    >
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        {[
          { w: 350, h: 350, top: "10%", left: "5%", bg: "rgba(255,199,0,0.5)", delay: "0s" },
          { w: 280, h: 280, top: "60%", right: "8%", bg: "rgba(255,180,0,0.4)", delay: "2s" },
          { w: 200, h: 200, bottom: "15%", left: "20%", bg: "rgba(255,220,80,0.35)", delay: "4s" },
        ].map((b, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              width: b.w,
              height: b.h,
              top: b.top,
              left: b.left,
              right: b.right,
              bottom: b.bottom,
              background: b.bg,
              borderRadius: "50%",
              filter: "blur(60px)",
              animation: `liquidBlob 6s ease-in-out ${b.delay} infinite`,
            }}
          />
        ))}
      </div>
      <div style={{ position: "relative", textAlign: "center" }}>
        <div
          style={{
            display: "flex",
            gap: 32,
            marginBottom: 40,
            justifyContent: "center",
            animation: "fadeUp .6s .2s var(--ease) both",
          }}
        >
          {[
            { icon: "/images/HC.png", label: "HealthCare" },
            { icon: "/images/GR.png", label: "Grooming" },
            { icon: "/images/SG.png", label: "Gaming" },
            { icon: "/images/RE.png", label: "Real Estate" },
          ].map((item, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                animationDelay: `${0.1 + i * 0.08}s`,
                animation: "fadeUp .6s var(--ease) both",
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  background: "rgba(0,0,0,0.08)",
                  backdropFilter: "blur(10px)",
                  borderRadius: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 30,
                  border: "1.5px solid rgba(0,0,0,0.1)",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.4)",
                  animation: `float ${3 + i * 0.5}s ease-in-out ${i * 0.3}s infinite`,
                }}
              >
                <img src={item.icon} alt={item.label} style={{ width: 32, height: 32 }} />
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            fontFamily: "'Playfair Display',serif",
            fontSize: "clamp(48px,8vw,80px)",
            fontWeight: 900,
            color: "var(--black)",
            letterSpacing: "-2px",
            lineHeight: 1,
            animation: "fadeUp .7s .5s var(--ease) both",
          }}
        >
          ClicknGo
        </div>
        <div
          style={{
            fontSize: 16,
            color: "rgba(0,0,0,0.55)",
            marginTop: 12,
            fontWeight: 500,
            animation: "fadeUp .6s .7s var(--ease) both",
          }}
        >
          Book Local. Live Better.
        </div>
        <div style={{ marginTop: 36, animation: "fadeIn .5s 1.6s ease both" }}>
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 99,
              background: "rgba(0,0,0,0.15)",
              margin: "0 auto",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                background: "rgba(0,0,0,0.4)",
                borderRadius: 99,
                animation: "shimmer 1.2s 1.6s ease-in-out both",
                backgroundImage: "linear-gradient(90deg,transparent,rgba(0,0,0,0.3),transparent)",
                backgroundSize: "200%",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
