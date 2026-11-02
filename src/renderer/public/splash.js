// Splash controller. Kept as a same-origin file because the app's CSP forbids inline scripts.
window.__t0 = performance.now()
window.__splash = {
  set: function (pct, msg) {
    var b = document.getElementById('sp-bar'), m = document.getElementById('sp-msg')
    if (b) b.style.width = pct + '%'
    if (m && msg) m.textContent = msg
  },
  done: function () {
    var s = document.getElementById('splash')
    if (!s) return
    s.classList.add('out')
    setTimeout(function () { s.remove() }, 950)
  }
}
