export class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === "string" ? detail : `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.detail !== undefined) detail = body.detail;
    } catch {
      // non-JSON body; keep default
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function listScenarios() {
  return request("/api/scenarios");
}

export function createScenario(body) {
  return request("/api/scenarios", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateScenario(id, body) {
  return request(`/api/scenarios/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteScenario(id) {
  return request(`/api/scenarios/${id}`, { method: "DELETE" });
}

export function listChunks() {
  return request("/api/chunks");
}

export function createChunk(body) {
  return request("/api/chunks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateChunk(id, body) {
  return request(`/api/chunks/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteChunk(id) {
  return request(`/api/chunks/${id}`, { method: "DELETE" });
}

export function startSession({ scenario_id, duration_sec }) {
  return request("/api/sessions/start", {
    method: "POST",
    body: JSON.stringify({ scenario_id, duration_sec }),
  });
}

export function assessSession(id, { self_assessment }) {
  return request(`/api/sessions/${id}/assess`, {
    method: "POST",
    body: JSON.stringify({ self_assessment }),
  });
}

export function getStreak() {
  return request("/api/streak");
}

export function listSessions({ limit = 20 } = {}) {
  return request(`/api/sessions?limit=${limit}`);
}
