const uuid =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
export function governancePath(path: string, method: string) {
  if (method === "GET" && path === "overview")
    return "/admin/organization/overview";
  if (method === "GET" && new RegExp("^operations/" + uuid + "$").test(path))
    return "/institutional/" + path;
  if (
    method === "GET" &&
    new RegExp("^facilities/" + uuid + "/cases$").test(path)
  )
    return "/institutional/" + path;
  if (
    method === "POST" &&
    new RegExp("^facilities/" + uuid + "/lifecycle$").test(path)
  )
    return "/institutional/" + path;
  if (method === "POST" && path === "organizations")
    return "/admin/organization";
  if (
    method === "POST" &&
    new RegExp(
      "^(facilities/" +
        uuid +
        "/(organization|assignment)|employees/" +
        uuid +
        "/profile|elevations|elevations/" +
        uuid +
        "/revoke)$",
    ).test(path)
  )
    return "/admin/organization/" + path;
  return null;
}
