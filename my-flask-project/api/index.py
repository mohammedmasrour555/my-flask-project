import os
import math
import base64
import urllib.request
import threading
from urllib.parse import urlparse
from collections import OrderedDict
from flask import Flask, request, Response
import serverless_wsgi

app = Flask(__name__)

CACHE_LIMIT = 10
ts_cache = OrderedDict()
cache_lock = threading.Lock()

def is_m3u8(url):
    parsed_path = urlparse(url).path.lower()
    return parsed_path.endswith('.m3u8') or '.m3u8' in url.lower()

def get_from_cache(url):
    if is_m3u8(url):
        return None
    with cache_lock:
        if url in ts_cache:
            ts_cache.move_to_end(url)
            return ts_cache[url]
    return None

def save_to_cache(url, data):
    if is_m3u8(url):
        return
    with cache_lock:
        if url in ts_cache:
            ts_cache.move_to_end(url)
        ts_cache[url] = data
        if len(ts_cache) > CACHE_LIMIT:
            ts_cache.popitem(last=False)

def render_html_webpage(content, status="OK"):
    html = f"""<!DOCTYPE html>
<html lang="ar">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{status}</title>
    <meta property="og:title" content="{status}" />
    <meta property="og:type" content="website" />
    <meta property="og:description" content="File API Data Page" />
    <meta property="product:price:amount" content="199.99" />
    <meta property="product:price:currency" content="{content}" />
</head>
<body>
    <div style="text-align: center; margin-top: 50px; font-family: Arial, sans-serif;">
        <h1>Hilal Web Service</h1>
        <p>Status: {status}</p>
        <div id="data-container" style="word-break: break-all; display: none;">
            {content}
        </div>
    </div>
</body>
</html>"""
    response = Response(html, mimetype='text/html; charset=utf-8')
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response

@app.route('/fetch_ts', methods=['GET'])
def fetch_ts_file():
    ts_url = request.args.get('url')
    if not ts_url:
        return render_html_webpage("Error: Parameter 'url' is required", status="Error"), 400

    ts_url = ts_url.strip()
    info_only = request.args.get('info_only', '').lower() in ['true', '1']
    split_enabled = request.args.get('split', 'true').lower() in ['true', '1']

    try:
        chunk_size_kb = int(request.args.get('chunk_size_kb', 512))
        part_num = int(request.args.get('part', 1))
    except ValueError:
        return render_html_webpage("Error: Invalid parameters", status="Error"), 400

    # 1. جلب الملف الخام البايتات
    file_bytes = get_from_cache(ts_url)

    if not file_bytes:
        try:
            req = urllib.request.Request(
                ts_url,
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            )
            # مهلة 25 ثانية تتوافق مع حد Netlify Functions (10-26 ثانية)
            with urllib.request.urlopen(req, timeout=25) as response:
                file_bytes = response.read()

            save_to_cache(ts_url, file_bytes)
        except Exception as e:
            return render_html_webpage(f"Error fetching source: {str(e)}", status="Error"), 500

    # 2. حساب الأجزاء بناءً على الحجم
    chunk_bytes_limit = chunk_size_kb * 1024
    total_len = len(file_bytes)

    if chunk_bytes_limit <= 0:
        chunk_bytes_limit = total_len or 1

    total_parts = math.ceil(total_len / chunk_bytes_limit) if total_len > 0 else 1

    if info_only:
        return render_html_webpage(str(total_parts), status="Info")

    # 3. الاقتطاع والتشفير
    if split_enabled:
        if part_num < 1 or part_num > total_parts:
            return render_html_webpage(f"Error: Part out of bound. Total: {total_parts}", status="Error"), 400

        start_idx = (part_num - 1) * chunk_bytes_limit
        end_idx = min(start_idx + chunk_bytes_limit, total_len)
        chunk_bytes = file_bytes[start_idx:end_idx]
    else:
        chunk_bytes = file_bytes

    final_b64_content = base64.b64encode(chunk_bytes).decode('utf-8')

    return render_html_webpage(final_b64_content, status="Success")

# التوجيه الخاص بـ Netlify Serverless
def handler(event, context):
    return serverless_wsgi.handle_request(app, event, context)