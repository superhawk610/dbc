const baseUrl = `http://${import.meta.env.VITE_API_BASE}`;

const NO_CONTENT = 204;

const req = (method: string) => {
  return async (path: string, data?: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}${path}`, {
      mode: "cors",
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    if (response.status === NO_CONTENT) {
      return null;
    }

    return response.json();
  };
};

export const get = req("GET");
export const post = req("POST");
export const put = req("PUT");
export const del = req("DELETE");
