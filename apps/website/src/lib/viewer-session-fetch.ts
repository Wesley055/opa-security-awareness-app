export async function viewerSessionFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);

  if (response.status !== 401) {
    return response;
  }

  const rotated = await fetch('/api/operator/refresh', {
    method: 'POST',
  });

  if (!rotated.ok) {
    return rotated;
  }

  return fetch(input, init);
}
