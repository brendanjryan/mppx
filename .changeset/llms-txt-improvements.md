---
"mppx": patch
---

- Simplified `llms.txt` to a brief service overview, linking each service to `/services/<id>`.
- Added `/services.md` and `/services/<id>.md` markdown endpoints with full route details.
- Added `Accept: text/markdown` / `text/plain` content negotiation on `/services` and `/services/<id>`.
- Added `Service.toServicesMarkdown()` and `Service.toMarkdown()` for markdown rendering.
- Changed `docsLlmsUrl` callback signature from `(endpoint?)` to `({ route? })`.
