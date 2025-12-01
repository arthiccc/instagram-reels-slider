// ==UserScript==
// @name         Instagram Reels Seek Slider
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adds a tappable/dragable seek slider to Instagram Reels on web for quick seeking.
// @match        https://www.instagram.com/*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  const CSS = `
  .reel-seek-overlay { position: absolute; left: 8px; right: 8px; bottom: 18px; height: 28px; z-index: 9999; display:flex; align-items:center; pointer-events:auto; }
  .reel-seek-bar { position:relative; flex:1; height:6px; background:rgba(255,255,255,0.18); border-radius:4px; overflow:hidden; touch-action:none; }
  .reel-seek-fill { position:absolute; left:0; top:0; bottom:0; width:0%; background:rgba(255,255,255,0.9); }
  .reel-seek-thumb { position:absolute; top:50%; transform:translate(-50%,-50%); width:14px; height:14px; border-radius:50%; background:#fff; box-shadow:0 2px 6px rgba(0,0,0,0.4); }
  .reel-time { margin-left:8px; color:#fff; font-size:12px; text-shadow:0 1px 2px rgba(0,0,0,0.6); min-width:64px; text-align:right; }
  `;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  let currentOverlay = null;
  let attachObserver = null;

  function formatTime(s) {
    if (!isFinite(s)) return '0:00';
    s = Math.max(0, Math.floor(s));
    const m = Math.floor(s/60);
    const sec = (s%60).toString().padStart(2,'0');
    return `${m}:${sec}`;
  }

  function createOverlay(video) {
    if (!video || video.dataset.hasSeekOverlay) return;
    video.dataset.hasSeekOverlay = '1';

    const container = document.createElement('div');
    container.className = 'reel-seek-overlay';
    container.style.pointerEvents = 'none';

    const barWrap = document.createElement('div');
    barWrap.className = 'reel-seek-bar';
    barWrap.style.pointerEvents = 'auto';

    const fill = document.createElement('div');
    fill.className = 'reel-seek-fill';
    const thumb = document.createElement('div');
    thumb.className = 'reel-seek-thumb';
    const timeLabel = document.createElement('div');
    timeLabel.className = 'reel-time';
    timeLabel.textContent = '0:00 / 0:00';

    barWrap.appendChild(fill);
    barWrap.appendChild(thumb);
    container.appendChild(barWrap);
    container.appendChild(timeLabel);

    // position overlay relative to video's nearest positioned ancestor
    const parent = video.closest('article, div[role="presentation"], section') || video.parentElement;
    parent.style.position = parent.style.position || 'relative';
    parent.appendChild(container);

    function updateUI() {
      const pct = (video.currentTime / (video.duration || 1)) * 100;
      fill.style.width = pct + '%';
      const rect = barWrap.getBoundingClientRect();
      const x = rect.left + (pct/100) * rect.width;
      thumb.style.left = Math.max(6, Math.min(rect.width-6, (pct/100)*rect.width)) + 'px';
      timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    }

    let dragging = false;
    let lastClientX = 0;
    let lastClientY = 0;
    let fineMode = false;
    let throttleTimer = null;

    function seekToClientX(clientX) {
      const rect = barWrap.getBoundingClientRect();
      let dx = clientX - rect.left;
      let pct = dx / rect.width;
      if (fineMode) {
        // reduce sensitivity for fine-scrub
        const currentPct = video.currentTime / (video.duration || 1);
        pct = currentPct + (pct - currentPct) * 0.12;
      }
      pct = Math.max(0, Math.min(1, pct));
      video.currentTime = pct * video.duration;
      updateUI();
    }

    function onPointerDown(e) {
      e.preventDefault();
      dragging = true;
      lastClientX = e.clientX || (e.touches && e.touches[0].clientX);
      lastClientY = e.clientY || (e.touches && e.touches[0].clientY);
      video.pause();
      barWrap.setPointerCapture && barWrap.setPointerCapture(e.pointerId);
      seekToClientX(lastClientX);
    }

    function onPointerMove(e) {
      if (!dragging) return;
      const cx = e.clientX || (e.touches && e.touches[0].clientX);
      const cy = e.clientY || (e.touches && e.touches[0].clientY);
      // detect vertical drag for fine mode
      fineMode = Math.abs(cy - lastClientY) > 8 && (cy - lastClientY) < 0;
      lastClientX = cx; lastClientY = cy;
      if (throttleTimer) return;
      throttleTimer = setTimeout(() => { throttleTimer = null; }, 60);
      seekToClientX(cx);
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      fineMode = false;
      video.play();
    }

    // tap-to-seek
    barWrap.addEventListener('click', (e) => {
      const clientX = e.clientX;
      seekToClientX(clientX);
    });

    // pointer/touch handlers
    barWrap.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    // fallback for touch
    barWrap.addEventListener('touchstart', onPointerDown, {passive:false});
    window.addEventListener('touchmove', onPointerMove, {passive:false});
    window.addEventListener('touchend', onPointerUp);

    // keyboard shortcuts when video focused
    video.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { video.currentTime = Math.min(video.duration, video.currentTime + 5); updateUI(); }
      if (e.key === 'ArrowLeft') { video.currentTime = Math.max(0, video.currentTime - 5); updateUI(); }
    });

    // update on timeupdate
    video.addEventListener('timeupdate', () => {
      if (!dragging) updateUI();
    });

    // initial update
    video.addEventListener('loadedmetadata', updateUI);
    updateUI();

    // cleanup reference
    currentOverlay = {video, container};
  }

  function scanAndAttach() {
    // find visible reel video element
    const videos = Array.from(document.querySelectorAll('video'));
    for (const v of videos) {
      // heuristics: visible and inside an article or reel container
      if (v.offsetParent === null) continue;
      if (v.closest('article') || v.closest('div[role="presentation"]')) {
        createOverlay(v);
      }
    }
  }

  // observe DOM changes to attach to newly loaded reels
  const mo = new MutationObserver(() => {
    scanAndAttach();
  });
  mo.observe(document.body, {childList:true, subtree:true});

  // initial pass
  setTimeout(scanAndAttach, 1200);
})();
