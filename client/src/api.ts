const baseUrl = "http://localhost:4000";

const req = (method: string) => {
  return async (path: string, data?: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}${path}`, {
      mode: "cors",
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    return response.json();
  };
};

export const get = req("GET");
export const post = req("POST");
export const put = req("PUT");
export const del = req("DELETE");
