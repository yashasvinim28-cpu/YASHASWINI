import { useEffect, useState, useRef } from "react";
import { fetchWithAuth } from "../utils/api";
import { resolveCategoryIdForRouteParam } from "../utils/categoryResolve";

/**
 * Loads services for a category route param using category_id (UUID) from API resolution.
 * Guards against stale responses when catId changes quickly.
 */
export function useCategoryServices(catId, retryKey = 0) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const seqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const mySeq = ++seqRef.current;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const categoryId = await resolveCategoryIdForRouteParam(catId);
        if (cancelled || seqRef.current !== mySeq) return;

        if (!categoryId) {
          setServices([]);
          setError("unknown_category");
          setLoading(false);
          return;
        }

        const { data } = await fetchWithAuth(`/services?category_id=${encodeURIComponent(categoryId)}`);
        if (cancelled || seqRef.current !== mySeq) return;
        setServices(Array.isArray(data) ? data : []);
      } catch (e) {
        if (cancelled || seqRef.current !== mySeq) return;
        setError(e.message || "fetch_failed");
        setServices([]);
      } finally {
        if (!cancelled && seqRef.current === mySeq) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [catId, retryKey]);

  return { services, loading, error };
}
