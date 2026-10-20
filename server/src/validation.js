export function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function listOptions(query, allowedSorts, defaultSort) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 10 : Number(query.limit);
  const sortKey = query.sort === undefined ? defaultSort : String(query.sort);
  const order = query.order === undefined ? "asc" : String(query.order).toLowerCase();
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw apiError(400, "Page must be positive and limit must be between 1 and 50.");
  }
  if (!Object.hasOwn(allowedSorts, sortKey) || !["asc", "desc"].includes(order)) {
    throw apiError(400, "Choose a supported sort field and order.");
  }
  return { page, limit, offset: (page - 1) * limit, sort: allowedSorts[sortKey], direction: order.toUpperCase() };
}

export function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validAppointmentTime(value, now = Date.now()) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) > now;
}
