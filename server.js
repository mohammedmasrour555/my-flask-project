import express from 'express';

const app = express();
// Fly.io يمرر المنفذ عبر متغيرة البيئة PORT تلقائياً أو يتم استخدام 3000
const PORT = process.env.PORT || 3000;

function renderHtmlWebpage(content, status = "OK", statusCode = 200) {
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
        <h1>Hilal Web Service</h1>
        <p>Status: ${status}</p>
        <div id="data-container" style="word-break: break-all; display: none;">
            ${content}
        </div>
    </div>
</body>
</html>`;

  return { html, statusCode };
}

app.get('/', (req, res) => {
  res.send('Server is running 24/7 on Fly.io');
});

app.get('/fetch_ts', async (req, res) => {
  const tsUrl = req.query.url;

  if (!tsUrl) {
    const { html, statusCode } = renderHtmlWebpage("Error: Parameter 'url' is required", "Error", 400);
    return res.status(statusCode).setHeader('Content-Type', 'text/html').send(html);
  }

  const infoOnly = ['true', '1'].includes((req.query.info_only || '').toLowerCase());
  const splitEnabled = ['true', '1'].includes((req.query.split || 'true').toLowerCase());

  const chunkSizeKb = parseInt(req.query.chunk_size_kb || '512', 10);
  const partNum = parseInt(req.query.part || '1', 10);

  if (isNaN(chunkSizeKb) || isNaN(partNum)) {
    const { html, statusCode } = renderHtmlWebpage("Error: Invalid parameters", "Error", 400);
    return res.status(statusCode).setHeader('Content-Type', 'text/html').send(html);
  }

  const cleanUrl = tsUrl.trim();

  // استخراج الـ Referer والـ Origin تلقائياً من رابط الستريم لضمان تخطي الحظر
  let refererUrl = "https://down.vidtube.one/";
  try {
    const parsedTs = new URL(cleanUrl);
    refererUrl = `${parsedTs.protocol}//${parsedTs.hostname}/`;
  } catch (e) {}

  try {
    const response = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Referer': refererUrl,
        'Origin': refererUrl.replace(/\/$/, ''),
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
        'Connection': 'keep-alive'
      }
    });

    if (!response.ok) {
      const { html, statusCode } = renderHtmlWebpage(`Error fetching source: HTTP ${response.status}`, "Error", response.status);
      return res.status(statusCode).setHeader('Content-Type', 'text/html').send(html);
    }

    const arrayBuffer = await response.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const totalLen = fileBuffer.length;

    let chunkBytesLimit = chunkSizeKb * 1024;
    if (chunkBytesLimit <= 0) {
      chunkBytesLimit = totalLen || 1;
    }

    const totalParts = totalLen > 0 ? Math.ceil(totalLen / chunkBytesLimit) : 1;

    if (infoOnly) {
      const { html, statusCode } = renderHtmlWebpage(totalParts.toString(), "Info", 200);
      return res.status(statusCode).setHeader('Content-Type', 'text/html').send(html);
    }

    let chunkBytes;
    if (splitEnabled) {
      if (partNum < 1 || partNum > totalParts) {
        const { html, statusCode } = renderHtmlWebpage(`Error: Part out of bound. Total parts: ${totalParts}`, "Error", 400);
        return res.status(statusCode).setHeader('Content-Type', 'text/html').send(html);
      }

      const startIdx = (partNum - 1) * chunkBytesLimit;
      const endIdx = Math.min(startIdx + chunkBytesLimit, totalLen);
      chunkBytes = fileBuffer.subarray(startIdx, endIdx);
    } else {
      chunkBytes = fileBuffer;
    }

    const finalB64Content = chunkBytes.toString('base64');
    const { html, statusCode } = renderHtmlWebpage(finalB64Content, "Success", 200);
    
    res.status(statusCode)
       .setHeader('Content-Type', 'text/html; charset=utf-8')
       .setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
       .send(html);

  } catch (error) {
    const { html, statusCode } = renderHtmlWebpage(`Server Error: ${error.message}`, "Error", 500);
    res.status(statusCode).setHeader('Content-Type', 'text/html').send(html);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});