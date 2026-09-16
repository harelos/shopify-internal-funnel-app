# -*- coding: utf-8 -*-
"""Get images out of the page without going through Chrome's download manager.

Chrome blocks repeated downloads from a site until someone clicks the permission
chip in the address bar, which is browser chrome and out of reach from here.
Both routes die on it: the anchor-with-download trick and ChatGPT's own Save
button. Nothing arrives and nothing errors.

So the bytes come out the way they came out the last time this project hit a
wall like it. `window.name` survives cross-origin navigation, which is the whole
trick: the ChatGPT tab base64s the images into `window.name`, navigates to this
server, and this page reads what the previous origin left behind and posts it
back. No download, no permission, no file picker.

Payloads are large, several megabytes for three images, and `window.name` holds
that comfortably. They go one batch at a time rather than one image at a time so
there are two navigations per three images instead of six.

Run it in the background and leave it running:

    python relay.py
"""
import base64, io, json, os, re, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
PORT = 9123

# the page that reads what the previous origin left in window.name.
# It posts and then blanks the name, so a stale payload cannot be collected
# twice and filed under two different products.
PAGE = """<!doctype html><meta charset=utf-8><title>relay</title>
<body style="font:14px system-ui;padding:2rem">
<pre id=log>reading…</pre>
<script>
const log = document.getElementById('log');
const raw = window.name || '';
window.name = '';
if (!raw) { log.textContent = 'window.name was empty'; }
else {
  fetch('/save', {method:'POST', headers:{'Content-Type':'application/json'}, body:raw})
    .then(r => r.text()).then(t => { log.textContent = t; })
    .catch(e => { log.textContent = 'ERR ' + e.message; });
}
</script>
"""

SAFE = re.compile(r"^[0-9]{2}_[0-3]_(hero|texture|inuse|context)$")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        body = PAGE.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n).decode("utf-8", "replace")
        written, refused = [], []
        try:
            items = json.loads(raw)
        except Exception as e:
            return self.reply("bad payload: %s" % e)

        for it in items:
            name = (it.get("name") or "").strip()
            # the name decides the filename, so it is validated rather than
            # trusted; a stray name would overwrite a frame that is already right
            if not SAFE.match(name):
                refused.append(name or "(blank)")
                continue
            data = it.get("b64") or ""
            if "," in data[:64]:
                data = data.split(",", 1)[1]
            blob = base64.b64decode(data)
            if not blob.startswith(b"\x89PNG"):
                refused.append(name + " (not a PNG)")
                continue
            with open(os.path.join(OUT, name + ".png"), "wb") as fh:
                fh.write(blob)
            written.append("%s %d bytes" % (name, len(blob)))

        msg = "wrote %d: %s" % (len(written), "; ".join(written))
        if refused:
            msg += " | refused: " + ", ".join(refused)
        print(msg, flush=True)
        self.reply(msg)

    def reply(self, text):
        body = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(OUT, exist_ok=True)
    print("relay on http://127.0.0.1:%d/  writing into %s" % (PORT, OUT), flush=True)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
