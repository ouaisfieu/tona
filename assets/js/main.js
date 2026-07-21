/* =========================================================================
   TONA — interactions (vanilla JS, aucune dépendance)
   ========================================================================= */
(function () {
  "use strict";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));

  /* ---- Année courante dans le pied de page ---- */
  $$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));

  /* ---- Header : état "collé" + barre de progression ---- */
  const header = $(".site-header");
  const progress = $(".progress");
  const onScroll = () => {
    const y = window.scrollY;
    if (header) header.classList.toggle("is-stuck", y > 8);
    if (progress) {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      progress.style.width = (max > 0 ? (y / max) * 100 : 0) + "%";
    }
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---- Navigation mobile ---- */
  const toggle = $(".nav__toggle");
  const links = $(".nav__links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    });
    $$("a", links).forEach((a) =>
      a.addEventListener("click", () => {
        links.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
      })
    );
  }

  /* ---- Révélation au défilement ---- */
  const revealables = $$(".reveal");
  if (revealables.length && "IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.style.transitionDelay = (e.target.dataset.delay || "0") + "ms";
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    revealables.forEach((el) => io.observe(el));
  } else {
    revealables.forEach((el) => el.classList.add("is-in"));
  }

  /* ---- Sommaire : surlignage de la section active ---- */
  const tocLinks = $$(".toc a");
  const heads = tocLinks
    .map((a) => document.getElementById(a.getAttribute("href").slice(1)))
    .filter(Boolean);
  if (heads.length && "IntersectionObserver" in window) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const id = e.target.id;
            tocLinks.forEach((a) =>
              a.classList.toggle("is-active", a.getAttribute("href") === "#" + id)
            );
          }
        });
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );
    heads.forEach((h) => spy.observe(h));
  }

  /* ---- Signal du hero : onde "propre" perturbée par des interférences ---- */
  const canvas = $(".hero__canvas");
  if (canvas && canvas.getContext) {
    const ctx = canvas.getContext("2d");
    let w, h, dpr, raf, t = 0;
    let bursts = []; // interférences ponctuelles

    const AMBER = "#F0B23C";
    const CORAL = "#E5533D";

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize, { passive: true });

    const wavePoint = (x, time) => {
      // onde composite (le "signal" d'un esprit)
      const base = Math.sin(x * 0.012 + time) * 16;
      const detail = Math.sin(x * 0.045 - time * 1.6) * 6;
      let interference = 0;
      for (const b of bursts) {
        const d = x - b.x;
        const env = Math.exp(-(d * d) / (2 * b.width * b.width));
        interference += env * b.amp * Math.sin(x * 0.9 + b.phase);
      }
      return { y: base + detail + interference, noise: interference };
    };

    const drawFrame = (time) => {
      ctx.clearRect(0, 0, w, h);
      const midY = h * 0.5;
      const step = 2;

      // ligne de base faible
      ctx.strokeStyle = "rgba(236,231,222,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();

      // le signal
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let peakNoise = 0;
      for (let x = 0; x <= w; x += step) {
        const p = wavePoint(x, time);
        peakNoise = Math.max(peakNoise, Math.abs(p.noise));
        const y = midY + p.y;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      // couleur : ambre au repos, vire au corail quand perturbé
      ctx.strokeStyle = peakNoise > 12 ? CORAL : AMBER;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // marqueurs verticaux discrets d'interférence
      for (const b of bursts) {
        ctx.strokeStyle = "rgba(229,83,61," + Math.min(0.5, b.amp / 40) + ")";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(b.x, midY - 60);
        ctx.lineTo(b.x, midY + 60);
        ctx.stroke();
      }
    };

    const tick = () => {
      t += 0.02;
      // décroissance des interférences
      bursts.forEach((b) => (b.amp *= 0.97));
      bursts = bursts.filter((b) => b.amp > 0.5);
      // apparition aléatoire d'une interférence
      if (Math.random() < 0.006 && bursts.length < 3) {
        bursts.push({
          x: Math.random() * w,
          amp: 26 + Math.random() * 22,
          width: 40 + Math.random() * 60,
          phase: Math.random() * Math.PI * 2,
        });
      }
      drawFrame(t);
      raf = requestAnimationFrame(tick);
    };

    if (reduceMotion) {
      // image fixe : un signal propre avec une interférence figée
      bursts.push({ x: w * 0.62, amp: 30, width: 55, phase: 1 });
      drawFrame(0.6);
    } else {
      tick();
      // met en pause hors écran pour économiser la batterie
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) cancelAnimationFrame(raf);
        else tick();
      });
    }
  }
})();
