/* Vantage Trade-In Widget — embed loader.
 *
 * Usage (dealer drops ONE line on their site):
 *   <script src="https://YOUR-HOST/embed.js" data-dealer="your-dealer-key"></script>
 *
 * Creates an isolated iframe pointing at the hosted widget and auto-resizes it
 * to fit content. Works on any site that allows a <script> tag. The iframe keeps
 * the dealer's CSS/JS from interfering with the widget and vice-versa.
 */
(function () {
  var script = document.currentScript;
  // The widget is served from the same origin this script is loaded from.
  var origin = new URL(script.src).origin;
  var dealer = script.getAttribute('data-dealer') || 'default';

  // Optional: a target element id to mount into (data-target="my-div").
  var targetId = script.getAttribute('data-target');
  var mount = targetId ? document.getElementById(targetId) : null;

  var iframe = document.createElement('iframe');
  iframe.src = origin + '/widget.html?dealer=' + encodeURIComponent(dealer);
  iframe.setAttribute('title', 'Get your instant trade-in offer');
  iframe.setAttribute('allow', 'geolocation');
  iframe.style.width = '100%';
  iframe.style.maxWidth = '480px';
  iframe.style.border = 'none';
  iframe.style.display = 'block';
  iframe.style.margin = '0 auto';
  iframe.style.height = '520px'; // initial; updated via postMessage
  iframe.scrolling = 'no';

  if (mount) {
    mount.appendChild(iframe);
  } else {
    // Insert right after the script tag.
    script.parentNode.insertBefore(iframe, script.nextSibling);
  }

  // Auto-resize: the widget posts its height as it changes.
  window.addEventListener('message', function (e) {
    if (e.origin !== origin) return;
    if (e.data && e.data.type === 'vantage-widget-height' && e.data.height) {
      iframe.style.height = (e.data.height + 8) + 'px';
    }
  });
})();
