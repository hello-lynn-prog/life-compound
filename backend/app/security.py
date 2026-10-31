# -*- coding: utf-8 -*-
"""
安全中间件：验证请求来源，只允许本机访问
========================================
威胁模型：本地服务虽然只监听 127.0.0.1，但同一台电脑上打开的恶意网页
仍可能尝试向 localhost 发请求（CSRF / DNS rebinding）。
防御：校验 Host 头必须是本机地址，且带 Origin 的写请求来源也必须是本机。
"""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

# 允许的主机名（不带端口，端口随启动配置变化）
ALLOWED_HOSTNAMES = {"127.0.0.1", "localhost"}


class LocalOnlyMiddleware(BaseHTTPMiddleware):
    """
    - Host 头的主机名不是 127.0.0.1/localhost → 403（挡住 DNS rebinding：
      恶意域名解析到 127.0.0.1 后，其 Host 仍是恶意域名，会被拒绝）
    - 写请求（POST/PUT/DELETE）带 Origin 且主机名不是本机 → 403（挡住外部网页的 CSRF）
    - 健康检查路径放行（方便启动脚本探测服务是否就绪）
    """

    @staticmethod
    def _hostname_ok(value: str) -> bool:
        """取 URL/Host 里的主机名部分（去掉端口）做白名单比对"""
        host = value.split("://", 1)[-1].split("/", 1)[0]
        name = host.rsplit(":", 1)[0] if host.count(":") == 1 else host  # 去端口号
        return name.lower() in ALLOWED_HOSTNAMES

    async def dispatch(self, request, call_next):
        if request.url.path == "/api/health":
            return await call_next(request)

        host = request.headers.get("host") or ""
        if host and not self._hostname_ok(host):
            return JSONResponse({"detail": "仅限本机访问"}, status_code=403)

        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            origin = request.headers.get("origin")
            if origin and not self._hostname_ok(origin):
                return JSONResponse({"detail": "请求来源不被允许"}, status_code=403)

        return await call_next(request)
