import { fetchWithAuth } from "./api";

/** Same normalization as backend: lower(name) with non-alphanumeric stripped */
export function slugifyName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Route param (e.g. from /category/:catId) may not equal DB slug
 * (e.g. "sports" vs "sportsgaming" for "Sports & Gaming").
 */
export const CATEGORY_ROUTE_TO_API_SLUG = {
  sports: "sportsgaming",
};

let categoriesCachePromise = null;

export function invalidateCategoriesCache() {
  categoriesCachePromise = null;
}

export async function fetchCategoriesList() {
  if (!categoriesCachePromise) {
    categoriesCachePromise = fetchWithAuth("/services/categories").then(({ data }) => {
      if (!Array.isArray(data)) return [];
      return data.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug ?? slugifyName(c.name),
      }));
    }).catch((error) => {
      categoriesCachePromise = null;
      throw error;
    });
  }
  return categoriesCachePromise;
}

/**
 * Resolve UUID category_id for GET /api/services?category_id=
 */
export async function resolveCategoryIdForRouteParam(routeCatId) {
  if (!routeCatId) return null;
  const list = await fetchCategoriesList();
  const byId = list.find((category) => category.id === routeCatId);
  if (byId) return byId.id;
  const normalized = slugifyName(routeCatId);
  const aliasedSlug = CATEGORY_ROUTE_TO_API_SLUG[routeCatId] || CATEGORY_ROUTE_TO_API_SLUG[normalized] || normalized;

  const bySlug = list.find((c) => c.slug === aliasedSlug || c.slug === normalized);
  if (bySlug) return bySlug.id;

  const byName = list.find((c) => slugifyName(c.name) === normalized);
  return byName?.id ?? null;
}
