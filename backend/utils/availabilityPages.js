const DEFAULT_PAGE_SIZE = 900;

async function fetchAllPages(fetchPage, pageSize = DEFAULT_PAGE_SIZE) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('pageSize must be a positive integer');
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    if (!Array.isArray(page)) throw new Error('Availability query returned an invalid page');
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

module.exports = { fetchAllPages, DEFAULT_PAGE_SIZE };
