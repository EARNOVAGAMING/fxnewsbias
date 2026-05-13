<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>
<xsl:template match="/">
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title><xsl:value-of select="rss/channel/title"/> — RSS Feed</title>
<link rel="icon" href="/favicon.ico"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous"/>
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&amp;display=swap" as="style"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#0f172a;color:#cbd5e1;font-family:'Inter',-apple-system,Segoe UI,sans-serif;line-height:1.6;padding:32px 20px 60px;}
.wrap{max-width:760px;margin:0 auto;}
.banner{background:linear-gradient(135deg,#1e3a8a 0%,#1e293b 100%);border-radius:12px;padding:22px;margin-bottom:24px;border-left:4px solid #60a5fa;}
.banner-label{color:#60a5fa;font-size:11px;font-weight:700;letter-spacing:1.5px;margin-bottom:6px;}
.banner-title{color:#fff;font-size:20px;font-weight:700;margin-bottom:8px;}
.banner-text{color:#cbd5e1;font-size:14px;line-height:1.6;}
.banner-text code{background:#0f172a;padding:3px 8px;border-radius:4px;color:#fbbf24;font-family:'JetBrains Mono',monospace;font-size:13px;word-break:break-all;}
.banner-text a{color:#60a5fa;}
h1{color:#fff;font-size:28px;font-weight:800;margin-bottom:6px;letter-spacing:-0.5px;}
.feed-desc{color:#94a3b8;font-size:14px;margin-bottom:28px;}
.item{background:#1e293b;border-radius:10px;padding:20px;margin-bottom:14px;border-left:3px solid #60a5fa;}
.item-date{color:#94a3b8;font-size:12px;letter-spacing:1px;font-weight:600;text-transform:uppercase;margin-bottom:6px;}
.item-title{margin-bottom:8px;}
.item-title a{color:#fff;text-decoration:none;font-size:17px;font-weight:700;line-height:1.4;}
.item-title a:hover{color:#60a5fa;}
.item-desc{color:#cbd5e1;font-size:14px;line-height:1.6;margin-bottom:8px;}
.item-link{color:#60a5fa;font-size:13px;font-weight:600;text-decoration:none;}
.back{display:inline-block;margin-top:24px;color:#94a3b8;font-size:13px;text-decoration:none;}
.back:hover{color:#fff;}
</style>
</head>
<body>
<div class="wrap">
  <div class="banner">
    <div class="banner-label">📡 RSS FEED</div>
    <div class="banner-title">This is an RSS feed</div>
    <div class="banner-text">
      Copy this page's URL into an RSS reader app (Feedly, Inoreader, Reeder, etc.) to get new insights delivered automatically every morning. No signup needed.
      <br/><br/>
      Or browse the articles below — same content, just easier to read.
    </div>
  </div>
  <h1><xsl:value-of select="rss/channel/title"/></h1>
  <p class="feed-desc"><xsl:value-of select="rss/channel/description"/></p>
  <xsl:for-each select="rss/channel/item">
    <div class="item">
      <div class="item-date"><xsl:value-of select="pubDate"/></div>
      <h2 class="item-title"><a><xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute><xsl:value-of select="title"/></a></h2>
      <p class="item-desc"><xsl:value-of select="description"/></p>
      <a class="item-link"><xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute>Read full insight →</a>
    </div>
  </xsl:for-each>
  <a class="back" href="/insight/">← Back to all insights</a>
</div>
</body>
</html>
</xsl:template>
</xsl:stylesheet>
