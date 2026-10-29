export async function fetchAvailabilityRows(fetcher, endpoint, signal) {
  const { data } = await fetcher(endpoint, { signal });
  if (!Array.isArray(data)) {
    throw new Error("Availability service returned an invalid response.");
  }
  return data;
}
