import { URL } from 'url';

const CACHE_LIMIT = 10;
const tsCache = new Map();

function isM3u8(url) {
  try {
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname.toLowerCase();
    return path.endsWith('.m3u8') || url.toLowerCase().includes('.m3u8');
  } catch (e) {
    return false;
  }
}

function getFromCache(url) {
  if (isM3u8(url)) return null;
  if (tsCache.has(url)) {
    const data = tsCache.get(url);
    tsCache.delete(url);
    tsCache.set(url, data);
    return data;
  }
  return null;
}

function saveToCache(url, data) {
  if (isM3u8(url)) return;
  if (tsCache.has(url)) {
    tsCache.delete(url);
  }
  tsCache.set(url, data);
  if (tsCache.size > CACHE_LIMIT) {
    const firstKey = tsCache.keys().next().value;
    tsCache.delete(firstKey);
  }
}

function renderHtmlWebpage(content, status = "OK") {
  const html = `<!DOCTYPE html>
<html lang="ar">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${status}</title>
    <meta property="og:title" content="${status}" />
    <meta property="og:type" content="website" />
    <meta property="og:description" content="File API Data Page" />
    <meta property="product:price:amount" content="199.99" />
    <meta property="product:price:currency" content="${content}" />
</head>
<body>
    <div style="text-align: center; margin-top: 50px; font-family: Arial, sans-serif;">
        <h1>storm Web Service</h1>
        </div>
    </div>
</body>
</html>`;

  return {
    statusCode: status === "Error" ? 400 : 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate"
    },
    body: html
  };
}

export async function handler(event, context) {
  const params = event.queryStringParameters || {};
  const tsUrl = params.url;

  if (!tsUrl) {
    return renderHtmlWebpage("Error: Parameter 'url' is required", "Error");
  }

  const infoOnly = ['true', '1'].includes((params.info_only || '').toLowerCase());
  const splitEnabled = ['true', '1'].includes((params.split || 'true').toLowerCase());

  const chunkSizeKb = parseInt(params.chunk_size_kb || '512', 10);
  const partNum = parseInt(params.part || '1', 10);

  if (isNaN(chunkSizeKb) || isNaN(partNum)) {
    return renderHtmlWebpage("Error: Invalid parameters", "Error");
  }

  const cleanUrl = tsUrl.trim();

  // 1. Fetching from cache or source
  let fileBuffer = getFromCache(cleanUrl);

  if (!fileBuffer) {
    try {
      const response = await fetch(cleanUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });

      if (!response.ok) {
        throw new Error(`HTTP Status ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuffer);
      saveToCache(cleanUrl, fileBuffer);
    } catch (e) {
      return renderHtmlWebpage(`Error fetching source: ${e.message}`, "Error");
    }
  }

  // 2. Calculate parts
  const totalLen = fileBuffer.length;
  let chunkBytesLimit = chunkSizeKb * 1024;

  if (chunkBytesLimit <= 0) {
    chunkBytesLimit = totalLen || 1;
  }

  const totalParts = totalLen > 0 ? Math.ceil(totalLen / chunkBytesLimit) : 1;

  if (infoOnly) {
    return renderHtmlWebpage(totalParts.toString(), "Info");
  }

  // 3. Slice & Base64
  let chunkBytes;
  if (splitEnabled) {
    if (partNum < 1 || partNum > totalParts) {
      return renderHtmlWebpage(`Error: Part out of bound. Total: ${totalParts}`, "Error");
    }

    const startIdx = (partNum - 1) * chunkBytesLimit;
    const endIdx = Math.min(startIdx + chunkBytesLimit, totalLen);
    chunkBytes = fileBuffer.subarray(startIdx, endIdx);
  } else {
    chunkBytes = fileBuffer;
  }

  const finalB64Content = chunkBytes.toString('base64');

  return renderHtmlWebpage(finalB64Content, "Success");
}
