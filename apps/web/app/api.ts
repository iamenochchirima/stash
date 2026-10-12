export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined && { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "The server is unavailable. Please try again.",
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiError(
      data.error || "Could not complete this request.",
      response.status,
    );
  return data;
}
