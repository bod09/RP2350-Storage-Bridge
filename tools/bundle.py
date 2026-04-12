#!/usr/bin/env python3
"""Bundle the web app into a single self-contained HTML file.

Uses esbuild to bundle JS (resolves ES module imports into a single IIFE),
inlines all CSS, and produces one HTML file that works from file:// URLs
(no CORS issues, no module imports, Web Serial works in secure context).

Usage:
    python3 tools/bundle.py [--outdir web/dist]

Outputs:
    web/dist/index.html          — single-file web app
    web/dist/storage-bridge.html — copy with friendly name for downloads
"""

import os
import re
import subprocess
import sys
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
DEFAULT_OUT = WEB_DIR / "dist"


def find_esbuild():
    """Find esbuild binary."""
    for cmd in ["esbuild", "npx esbuild"]:
        if shutil.which(cmd.split()[0]):
            return cmd
    return None


def bundle_js(web_dir):
    """Bundle all JS into a single IIFE using esbuild."""
    esbuild = find_esbuild()
    if not esbuild:
        print("ERROR: esbuild not found. Install with: npm i -g esbuild", file=sys.stderr)
        sys.exit(1)

    entry = web_dir / "js" / "app.js"
    cmd = f"{esbuild} {entry} --bundle --format=iife --minify --target=es2020"
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=str(web_dir))

    if result.returncode != 0:
        print(f"esbuild failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)

    return result.stdout


def collect_css(web_dir):
    """Concatenate all CSS files in order."""
    css_dir = web_dir / "css"
    # Order matters: tokens first, then layout, then component styles
    order = ["tokens.css", "layout.css", "sidebar.css", "file-browser.css",
             "upload.css", "components.css"]
    parts = []
    for name in order:
        p = css_dir / name
        if p.exists():
            parts.append(p.read_text())
    return "\n".join(parts)


def build_html(web_dir, bundled_js, bundled_css):
    """Read index.html and inline JS + CSS."""
    html = (web_dir / "index.html").read_text()

    # Remove all <link rel="stylesheet" ...> tags
    html = re.sub(r'<link\s+rel="stylesheet"\s+href="[^"]*"\s*/?>', '', html)

    # Remove the <script type="module" src="js/app.js"></script> tag
    html = re.sub(r'<script\s+type="module"\s+src="js/app\.js"\s*></script>', '', html)

    # Remove manifest link (not needed in single-file mode)
    html = re.sub(r'<link\s+rel="manifest"\s+href="[^"]*"\s*/?>', '', html)

    # Remove service worker registration script block in the inline <script>
    # (the sw.js reference won't work from file://)

    # Insert inlined CSS before </head>
    style_block = f"<style>\n{bundled_css}\n</style>"
    html = html.replace("</head>", f"{style_block}\n</head>")

    # Insert bundled JS before </body>
    # Use regular script (not module) since esbuild outputs IIFE
    script_block = f"<script>\n{bundled_js}\n</script>"
    html = html.replace("</body>", f"{script_block}\n</body>")

    # Clean up multiple blank lines
    html = re.sub(r'\n{3,}', '\n\n', html)

    return html


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Bundle web app into single HTML file")
    parser.add_argument("--outdir", default=str(DEFAULT_OUT), help="Output directory")
    args = parser.parse_args()

    out_dir = Path(args.outdir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("Bundling JS with esbuild...")
    bundled_js = bundle_js(WEB_DIR)
    print(f"  JS bundle: {len(bundled_js):,} bytes")

    print("Collecting CSS...")
    bundled_css = collect_css(WEB_DIR)
    print(f"  CSS bundle: {len(bundled_css):,} bytes")

    print("Building single-file HTML...")
    html = build_html(WEB_DIR, bundled_js, bundled_css)
    print(f"  HTML output: {len(html):,} bytes")

    # Write outputs
    index_path = out_dir / "index.html"
    index_path.write_text(html)
    print(f"  Written: {index_path}")

    # Friendly-named copy for release downloads
    friendly_path = out_dir / "storage-bridge.html"
    friendly_path.write_text(html)
    print(f"  Written: {friendly_path}")

    print("Done.")


if __name__ == "__main__":
    main()
