import http from "http";

/**
 * 0ms OPTIONS 跨域预检短路拦截器 (算法 4)
 * 在网关最前端拦截所有浏览器的复杂请求预检探测包，直接就地写入 CORS 头并响应 HTTP 200，
 * 避免耗时的路由扫描、鉴权与业务上下文开销。
 */
export function handleCorsPreflight(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  const httpPort = parseInt(process.env.HTTP_PORT || "8000", 10);
  const nodeNum = process.env.NODE_ID
    ? parseInt(process.env.NODE_ID.replace(/[^\d]/g, ""), 10) || (httpPort - 8000 + 1)
    : httpPort - 8000 + 1;

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, token, X-Backend-Node, X-Requested-With, X-School-Code, X-Backend-Server-ID",
    "Access-Control-Expose-Headers": "X-Backend-Node, Content-Disposition",
    "Access-Control-Max-Age": "86400", // 24小时浏览器缓存预检结果
    "X-Backend-Node": String(nodeNum),
  });

  res.end(JSON.stringify({ status: 1, content: "OK" }));
}
