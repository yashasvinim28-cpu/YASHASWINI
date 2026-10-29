import { useEffect } from "react";

const FALLBACK = "Street 133, Times Square, NYC";

export function useLocation(setLocation, setCoords) {
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocation(FALLBACK);
      setCoords?.(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setCoords?.({ latitude, longitude });
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
        fetch(url, {
          headers: { Accept: "application/json", "User-Agent": "ClicknGo/1.0" },
        })
          .then((r) => r.json())
          .then((data) => {
            const addr = data?.address;
            if (addr) {
              const parts = [
                addr.road || addr.street,
                addr.suburb || addr.neighbourhood,
                addr.city || addr.town || addr.village || addr.municipality,
                addr.state,
              ].filter(Boolean);
              const str = parts.join(", ") || data?.display_name || FALLBACK;
              setLocation(str);
            } else {
              setLocation(data?.display_name || FALLBACK);
            }
          })
          .catch(() => setLocation(FALLBACK));
      },
      () => {
        setLocation(FALLBACK);
        setCoords?.(null);
      }
    );
  }, [setLocation, setCoords]);
}
