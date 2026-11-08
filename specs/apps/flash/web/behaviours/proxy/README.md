# Proxy

Scenarios for the web server's `/api/v1/sales/*` and `/api/v1/auth/*` routes, which pass the browser's requests and cookies on to the API. A path without the version, and the operator routes, are refused.

## Directory Map

- [api.feature](api.feature) - what the browser can reach, what stays hidden, the paths without the version, how the cookies of a login pass through, the check against requests from another site, the address the API is told, the request id the API and the browser share, and what happens when the API is down.
