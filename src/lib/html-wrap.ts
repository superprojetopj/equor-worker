export function wrapTinyMceHtml(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    *, *::before, *::after { box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #000;
      background: #fff;
      margin: 0;
      padding: 0;
    }

    h1, h2, h3, h4, h5, h6 {
      margin-top: 1em;
      margin-bottom: 0.5em;
      font-weight: 600;
      line-height: 1.3;
    }
    h1 { font-size: 2em; }
    h2 { font-size: 1.5em; }
    h3 { font-size: 1.25em; }

    p { margin: 0.75em 0; }

    ul, ol {
      margin: 0.75em 0;
      padding-left: 2em;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.75em 0;
    }
    table td, table th {
      border: 1px solid #ccc;
      padding: 6px 10px;
      vertical-align: top;
    }
    table th {
      background: #f4f4f4;
      font-weight: 600;
    }

    img { max-width: 100%; height: auto; }

    a { color: #1a73e8; }

    blockquote {
      margin: 0.75em 0 0.75em 1.5em;
      padding-left: 1em;
      border-left: 3px solid #ccc;
      color: #555;
    }

    pre, code {
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.9em;
      background: #f5f5f5;
      border-radius: 3px;
    }
    pre { padding: 12px; overflow: auto; }
    code { padding: 2px 4px; }

    hr { border: none; border-top: 1px solid #ccc; margin: 1.5em 0; }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`
}
