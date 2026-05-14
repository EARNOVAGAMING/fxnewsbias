// FXNewsBias - Cookie Consent Banner
document.addEventListener('DOMContentLoaded', function () {

  // Only show if user hasn't responded yet — respect both Accept and Decline.
  const consent = localStorage.getItem('fxnewsbias_cookie_consent');
  if (consent === 'accepted' || consent === 'declined') return;

  // Create banner
  const banner = document.createElement('div');
  banner.id = 'cookie-banner';
  banner.innerHTML = `
    <div style="
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #0f172a;
      color: #fff;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      z-index: 9999;
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      box-shadow: 0 -4px 20px rgba(0,0,0,0.2);
    ">
      <div style="flex:1;min-width:200px;color:#94a3b8;line-height:1.5;">
        🍪 We use cookies to enhance your experience, analyze traffic, and serve ads.
        By continuing to use FXNewsBias, you agree to our
        <a href="/privacy" style="color:#60a5fa;text-decoration:none;">Privacy Policy</a>
        and
        <a href="/terms" style="color:#60a5fa;text-decoration:none;">Terms of Service</a>.
      </div>
      <div style="display:flex;gap:10px;flex-shrink:0;">
        <button id="cookie-decline" style="
          padding: 8px 18px;
          background: transparent;
          color: #94a3b8;
          border: 1px solid #334155;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        ">Decline</button>
        <button id="cookie-accept" style="
          padding: 8px 18px;
          background: #2563eb;
          color: #fff;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        ">Accept All</button>
      </div>
    </div>
  `;

  document.body.appendChild(banner);

  // Accept button
  document.getElementById('cookie-accept').addEventListener('click', function () {
    localStorage.setItem('fxnewsbias_cookie_consent', 'accepted');
    banner.remove();
  });

  // Decline button
  document.getElementById('cookie-decline').addEventListener('click', function () {
    localStorage.setItem('fxnewsbias_cookie_consent', 'declined');
    banner.remove();
  });

});
