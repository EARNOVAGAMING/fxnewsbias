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
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#ffffff;color:#1a1a1a;font-family:'Inter',-apple-system,Segoe UI,sans-serif;line-height:1.5;}
.head{background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;padding:32px 20px;}
.head-inner{max-width:760px;margin:0 auto;}
.crumb{font-size:13px;color:#94a3b8;margin-bottom:8px;}
.crumb a{color:#94a3b8;text-decoration:none;}
.head h1{font-size:28px;font-weight:800;letter-spacing:-0.5px;margin-bottom:6px;color:#fff;}
.head p{color:#94a3b8;font-size:14px;}
.wrap{max-width:760px;margin:24px auto;padding:0 20px 60px;}
.banner{background:linear-gradient(135deg,#eff6ff,#dbeafe);border:1px solid #bfdbfe;border-radius:10px;padding:18px;margin-bottom:24px;color:#1e40af;}
.banner-label{color:#2563eb;font-size:11px;font-weight:800;letter-spacing:1.5px;margin-bottom:6px;text-transform:uppercase;}
.banner-title{color:#0f172a;font-size:18px;font-weight:800;margin-bottom:8px;}
.banner-text{font-size:14px;line-height:1.6;color:#1e3a8a;}
.banner-text code{background:#dbeafe;padding:2px 6px;border-radius:3px;color:#1e40af;font-family:monospace;font-size:13px;}
.item{background:#fff;border:1px solid #e5e7eb;border-radius:10px;border-left:4px solid #2563eb;padding:18px;margin-bottom:12px;transition:box-shadow .15s;}
.item:hover{box-shadow:0 4px 14px rgba(37,99,235,.08);}
.item-date{color:#6b7280;font-size:11px;letter-spacing:1px;font-weight:700;text-transform:uppercase;margin-bottom:6px;}
.item-title{margin-bottom:8px;}
.item-title a{color:#1a1a1a;text-decoration:none;font-size:17px;font-weight:800;line-height:1.4;letter-spacing:-0.2px;}
.item-title a:hover{color:#2563eb;}
.item-desc{color:#374151;font-size:14px;line-height:1.6;margin-bottom:8px;}
.item-link{color:#2563eb;font-size:13px;font-weight:700;text-decoration:none;}
.back{display:inline-block;margin-top:16px;color:#2563eb;font-size:13px;text-decoration:none;font-weight:600;}
</style>
</head>
<body>
<div class="head">
  <div class="head-inner">
    <div class="crumb"><a href="/">Home</a> · <a href="/insight/">Insights</a> · <span>RSS Feed</span></div>
    <h1><xsl:value-of select="rss/channel/title"/></h1>
    <p><xsl:value-of select="rss/channel/description"/></p>
  </div>
</div>
<div class="wrap">
  <div class="banner">
    <div class="banner-label">📡 What is this page?</div>
    <div class="banner-title">This is an RSS feed</div>
    <div class="banner-text">
      Copy this page's URL and paste it into an RSS reader app (Feedly, Inoreader, Reeder, etc.) to get new insights delivered automatically every morning. No signup needed.<br/><br/>
      Or just browse the articles below — same content, easier to read.
    </div>
  </div>
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
