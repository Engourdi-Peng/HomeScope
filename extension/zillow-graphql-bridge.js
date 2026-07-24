(function() {
  if (window.__HS_GRAPHQL_CAPTURE_LOADED__) return;
  window.__HS_GRAPHQL_CAPTURE_LOADED__ = true;
  var script = document.createElement('script');
  script.src = chrome.runtime.getURL('zillow-graphql-capture.js');
  script.async = false;
  (document.head || document.documentElement).appendChild(script);
})();
