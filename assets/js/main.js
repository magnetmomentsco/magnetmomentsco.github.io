/* ============================================
   MAGNET MOMENTS CO. — Main JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  // ---- Navbar Scroll ----
  const navbar = document.querySelector('.navbar');
  const handleScroll = () => {
    if (!navbar) return;
    navbar.classList.toggle('scrolled', window.scrollY > 50);
    // Back to top
    const btt = document.querySelector('.back-to-top');
    if (btt) btt.classList.toggle('visible', window.scrollY > 600);
  };
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  // ---- Mobile Nav ----
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  const navOverlay = document.querySelector('.nav-overlay');

  const closeNav = () => {
    navToggle.classList.remove('active');
    navLinks.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
    if (navOverlay) navOverlay.classList.remove('active');
    document.body.style.overflow = '';
  };

  if (navToggle && navLinks) {
    navToggle.setAttribute('aria-expanded', 'false');

    navToggle.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('open');
      navToggle.classList.toggle('active');
      navToggle.setAttribute('aria-expanded', String(isOpen));
      if (navOverlay) navOverlay.classList.toggle('active');
      document.body.style.overflow = isOpen ? 'hidden' : '';
      if (isOpen) {
        // Focus first focusable element in nav
        const first = navLinks.querySelector('a, button');
        if (first) first.focus();
      }
    });

    if (navOverlay) {
      navOverlay.addEventListener('click', closeNav);
    }

    // Close on link click
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', closeNav);
    });

    // Escape key to close nav
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navLinks.classList.contains('open')) {
        closeNav();
        navToggle.focus();
      }
    });
  }

  // ---- Active nav link ----
  const currentPath = window.location.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  document.querySelectorAll('.nav-links a').forEach(link => {
    const href = link.getAttribute('href');
    if (!href) return;
    const linkPath = href.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
    if (linkPath === currentPath || (currentPath === '/' && linkPath === '/')) {
      link.classList.add('active');
    }
  });

  // ---- Scroll Animations (Intersection Observer) ----
  const animatedElements = document.querySelectorAll('.fade-in, .fade-in-left, .fade-in-right, .stagger-children');
  if (animatedElements.length > 0) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    animatedElements.forEach(el => observer.observe(el));
  }

  // ---- FAQ Accordion ----
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const answer = item.querySelector('.faq-answer');
      const isActive = item.classList.contains('active');

      // Close all
      document.querySelectorAll('.faq-item.active').forEach(openItem => {
        openItem.classList.remove('active');
        openItem.querySelector('.faq-answer').style.maxHeight = null;
        openItem.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
      });

      // Open clicked (if wasn't already open)
      if (!isActive) {
        item.classList.add('active');
        answer.style.maxHeight = answer.scrollHeight + 'px';
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // ---- Newsletter Popup ----
  const popup = document.getElementById('newsletter-popup');
  if (popup) {
    const dismissed = sessionStorage.getItem('popup-dismissed');
    if (!dismissed) {
      setTimeout(() => {
        popup.classList.add('active');
        document.dispatchEvent(new CustomEvent('mm:popup-shown'));
      }, 4000);
    }

    const closePopup = (method) => {
      popup.classList.remove('active');
      sessionStorage.setItem('popup-dismissed', '1');
      document.dispatchEvent(new CustomEvent('mm:popup-dismissed', { detail: { method: method || 'unknown' } }));
    };

    popup.querySelector('.popup-close')?.addEventListener('click', () => closePopup('x'));
    popup.addEventListener('click', (e) => {
      if (e.target === popup) closePopup('click-outside');
    });

    // Escape key to close popup
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && popup.classList.contains('active')) {
        closePopup('escape');
      }
    });

    // Newsletter form submit
    const popupForm = popup.querySelector('form');
    if (popupForm) {
      popupForm.addEventListener('submit', () => {
        document.dispatchEvent(new CustomEvent('mm:popup-submitted'));
      });
    }
  }

  // ---- Smooth scroll for anchor links ----
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const offset = navbar ? navbar.offsetHeight + 20 : 80;
        const y = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
    });
  });

  // ---- Back to Top ----
  const backToTop = document.querySelector('.back-to-top');
  if (backToTop) {
    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ---- Form success message ----
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('success') === 'true') {
    const formSection = document.querySelector('.contact-form, .newsletter-form');
    if (formSection) {
      const msg = document.createElement('div');
      msg.setAttribute('role', 'alert');
      msg.style.cssText = 'background:#7A9D54;color:white;padding:1rem 1.5rem;border-radius:8px;text-align:center;margin-bottom:1.5rem;font-weight:600;';
      msg.textContent = '✓ Message sent! We\'ll get back to you soon.';
      formSection.parentElement.insertBefore(msg, formSection);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  // ---- Marquee pause on hover ----
  const marquee = document.querySelector('.marquee-inner');
  if (marquee) {
    const parent = marquee.closest('.marquee');
    parent?.addEventListener('mouseenter', () => { marquee.style.animationPlayState = 'paused'; });
    parent?.addEventListener('mouseleave', () => { marquee.style.animationPlayState = 'running'; });
  }

  // ---- Counter animation ----
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length) {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const target = parseInt(el.dataset.count, 10);
          const suffix = el.dataset.suffix || '';
          const duration = 2000;
          const start = performance.now();

          const animate = (now) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.floor(eased * target) + suffix;
            if (progress < 1) requestAnimationFrame(animate);
          };
          requestAnimationFrame(animate);
          counterObserver.unobserve(el);
        }
      });
    }, { threshold: 0.5 });

    counters.forEach(c => counterObserver.observe(c));
  }

});
