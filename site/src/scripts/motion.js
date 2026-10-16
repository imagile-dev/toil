// Shared scroll motion: subtle parallax on [data-parallax] elements and a
// reveal-on-scroll for [data-reveal] elements. One listener, one observer,
// used site-wide instead of per-component scripts.
//
// Content is visible by default in CSS -- the pre-reveal hidden state only
// exists once <html> carries .reveal-armed, which this script adds only
// when it's actually going to manage the reveal (motion allowed, observer
// supported). That ordering matters: if this script never runs, errors, or
// is blocked, nothing on the page silently disappears.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const parallaxItems = Array.from(document.querySelectorAll('[data-parallax]'));
if (parallaxItems.length && !reduceMotion.matches) {
  let ticking = false;
  const updateParallax = () => {
    const scrollY = window.scrollY;
    for (const item of parallaxItems) {
      const speed = Number(item.dataset.parallax || 0);
      item.style.setProperty('--parallax-y', `${scrollY * speed}px`);
    }
    ticking = false;
  };
  updateParallax();
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(updateParallax);
      }
    },
    { passive: true }
  );
}

const revealItems = document.querySelectorAll('[data-reveal]');
if (revealItems.length && 'IntersectionObserver' in window && !reduceMotion.matches) {
  document.documentElement.classList.add('reveal-armed');
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
  );
  revealItems.forEach((item) => observer.observe(item));
}
