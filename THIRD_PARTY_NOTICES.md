# 第三方组件

本目录的轻量网页版使用了以下开源组件，均以原样文件随页面提供：

- **JSZip** — MIT License — https://github.com/Stuk/jszip
  - 文件：`vendor/jszip.min.js`
  - 用途：在浏览器里打包 .docx（OOXML）文件。
- **PDF.js** — Apache License 2.0 — https://github.com/mozilla/pdf.js
  - 文件：`vendor/pdfjs/pdf.min.js`、`vendor/pdfjs/pdf.worker.min.js`
  - 用途：把用户选择的 PDF 页面在浏览器内转成图片，供识图模型读取。

页面、样式、`app.js`、`lib/docx.js`、`lib/markdown.js`、`worker/index.js` 为本项目代码。
