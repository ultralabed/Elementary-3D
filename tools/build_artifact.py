#!/usr/bin/env python3
"""Build dist/artifact.html: ONE self-contained file for pasting into an artifact host.

Layout of the output (no <!doctype>/<html>/<head>/<body> tags):
  <title>, <meta viewport-fit-sides>, one <style> (css/style.css inlined),
  the HUD body markup from index.html, the cdnjs three.js <script>, then every
  local script from index.html inlined in order in its own <script> tag.

The recordings in audio/*.mp3 are embedded as base64 (window.CAMPUS_AUDIO_DATA) because the
single file cannot fetch anything.  The same run rewrites audio/manifest.json, the list of
recordings the normal page may request, so a missing file is never fetched.  Re-run it after
adding or removing a recording.

Usage:  python3 tools/build_artifact.py
"""
import base64
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


AUDIO_NAMES = ["classroom", "kids", "cafeteria"]


def audio_files():
    found = {}
    for name in AUDIO_NAMES:
        p = os.path.join(ROOT, "audio", name + ".mp3")
        if os.path.isfile(p):
            with open(p, "rb") as f:
                found[name] = f.read()
    return found


def main():
    audio = audio_files()
    with open(os.path.join(ROOT, "audio", "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"files": sorted(audio, key=AUDIO_NAMES.index)}, f)
        f.write("\n")
    html = read("index.html")
    body = re.search(r"<body[^>]*>(.*)</body>", html, re.S).group(1)
    # local scripts, in the order index.html loads them
    scripts = re.findall(r'<script\s+src="(js/[^"]+)"></script>', body)
    if not scripts:
        sys.exit("no local scripts found in index.html")
    markup = re.sub(r"<script\b[^>]*></script>", "", body)       # drop all script tags from the markup
    markup = re.sub(r"<!--.*?-->", "", markup, flags=re.S).strip()  # drop HTML comments
    css = read("css/style.css")
    out = []
    out.append("<title>Maple Star Elementary 3D</title>")
    out.append('<meta name="claude:viewport-fit-sides" content="cover">')
    out.append("<style>\n" + css.replace("</style", "<\\/style") + "\n</style>")
    out.append(markup)
    out.append('<script src="%s"></script>' % THREE_URL)
    for rel in scripts:
        if rel == "js/audio.js":
            data = {k: base64.b64encode(v).decode("ascii") for k, v in audio.items()}
            out.append("<script>\n// ---- embedded recordings ----\nwindow.CAMPUS_AUDIO_DATA = %s;\n</script>" % json.dumps(data))
        js = read(rel).replace("</script", "<\\/script")
        out.append("<script>\n// ---- %s ----\n%s\n</script>" % (rel, js))
    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    path = os.path.join(ROOT, "dist", "artifact.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print("wrote %s (%d KB, %d scripts, %d recordings)" % (path, os.path.getsize(path) // 1024, len(scripts), len(audio)))


if __name__ == "__main__":
    main()
