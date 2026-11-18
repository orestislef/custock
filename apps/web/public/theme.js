// appearance before the first paint: Automatic follows the system (no attribute, the css media
// query decides), Light or Dark set data-theme on <html>. chosen in the account sheet, stored on
// this device only. kept in step with src/lib/appearance.ts. an external file so the page needs no
// inline script under the content security policy.
(function () {
  var KEY = 'custock.appearance';
  var COLORS = { light: '#F3F3F0', dark: '#0F0F12' };
  var v = null;
  try { v = localStorage.getItem(KEY); } catch (e) {}
  if (v !== 'light' && v !== 'dark') return;
  document.documentElement.setAttribute('data-theme', v);
  // the browser bar color: next adds the theme-color tags later (some while streaming), so every
  // tag gets the picked color as it appears, for the first seconds of the page
  function bar(el) { el.setAttribute('content', COLORS[v]); }
  function all() {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) bar(metas[i]);
  }
  all();
  if (window.MutationObserver) {
    var mo = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var nodes = list[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          if (n.nodeName === 'META' && n.getAttribute('name') === 'theme-color') bar(n);
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('load', function () { all(); setTimeout(function () { mo.disconnect(); all(); }, 3000); }, { once: true });
  }
})();
